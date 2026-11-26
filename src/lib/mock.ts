import type { RouteFileStatus, RouteHealth, RoutedTo, TrafficEvent } from "../store/types";
import { loadEnabledRoutes } from "./prefs";

const HOSTS = ["api.mock.dev", "cdn.mock.dev", "auth.mock.dev", "graphql.mock.dev"];
const PATHS = ["/v1/users", "/v1/orders", "/v1/session", "/graphql", "/v1/items?page=2", "/health"];
const METHODS = ["GET", "GET", "GET", "POST", "PUT", "DELETE"];
const STATUSES = [200, 200, 200, 201, 204, 304, 400, 404, 500];

const MOCK_ROUTES_PATH = "/mock/routes.json";

function mockRoute(id: string, port: number, path = MOCK_ROUTES_PATH) {
  return {
    key: `${path}::${id}`,
    id,
    path_prefix: `/v1/${id}`,
    host: null,
    target: `http://127.0.0.1:${port}`,
    enabled: false,
  };
}

const MOCK_ROUTE_FILES: RouteFileStatus[] = [
  {
    path: MOCK_ROUTES_PATH,
    name: "local stack",
    error: null,
    routes: [mockRoute("orders", 4010), mockRoute("items", 4020), mockRoute("session", 4030)],
  },
  {
    path: "/mock/draft.json",
    name: "draft.json",
    error: "unsupported route file version 2 (supported: 1)",
    routes: [],
  },
];

const MOCK_DISCOVERED = [
  { id: "dev", label: "Dev", path: "/mock/routes-dev.json", hint: "make dev" },
  { id: "staging", label: "Staging", path: "/mock/routes-staging.json", hint: "make staging" },
  { id: "preview", label: "Preview", path: "/mock/routes-broken.json", hint: null },
];

const MOCK_BROKEN = "invalid route file: missing field `routes` at line 1 column 14";

function mockFile(path: string): RouteFileStatus {
  const known = MOCK_ROUTE_FILES.find((file) => file.path === path);
  if (known) return known;
  const base = path.includes("staging") ? 5000 : 4000;
  return {
    path,
    name: path.split("/").pop()?.replace(/\.json$/, "") ?? path,
    error: null,
    routes: ["orders", "items", "session"].map((id, i) => mockRoute(id, base + (i + 1) * 10, path)),
  };
}

function mockHealth(target: string): RouteHealth {
  return /:(4020|50\d\d)$/.test(target) ? "down" : "up";
}

export const ROUTE_MOCK_COMMANDS = [
  "list_routes",
  "reload_routes",
  "routes_health",
  "discover_routes",
  "connect_route_file",
  "remove_route_file",
];

export function createRoutesMock(search: string, delayMs = 700) {
  const params = new URLSearchParams(search);
  let files = params.get("routes") === "empty" ? [] : MOCK_ROUTE_FILES;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const paths = () => files.map((file) => file.path);
  const fail = (kind: string, message: string) => Promise.reject({ kind, message });

  async function discover(address: string) {
    const local = /^http:\/\/(localhost|127\.0\.0\.1):(\d+)\/?$/.exec(address);
    if (!local) return fail("invalidAddress", `\`${address}\` is not a local address`);
    const port = local[2];
    await wait(port === "8092" ? delayMs * 90 : delayMs);
    if (port === "8091") {
      return fail("invalidResponse", "unsupported discovery version 2 (supported: 1)");
    }
    if (port !== "8090" && port !== "8092") return fail("unreachable", "connection refused");
    return {
      name: "local stack",
      address: address.replace(/\/$/, ""),
      files: MOCK_DISCOVERED.map((file) => {
        const error = file.path.includes("broken") ? MOCK_BROKEN : null;
        const routes = error ? [] : mockFile(file.path).routes;
        const up = routes.filter((r) => mockHealth(r.target) === "up").length;
        return { ...file, routes: routes.length, up, error };
      }),
    };
  }

  async function connect(path: string, replaces: string[]) {
    await wait(delayMs);
    if (path.includes("broken")) return fail("invalidFile", MOCK_BROKEN);
    if (params.get("config") === "broken") {
      return fail("config", "parse error: TOML parse error at line 3, column 8");
    }
    const before = paths();
    const next = before.filter((file) => file === path || !replaces.includes(file));
    if (!next.includes(path)) next.push(path);
    files = next.map(mockFile);
    const reset = [...before.filter((f) => !next.includes(f)), ...next.filter((f) => !before.includes(f))];
    return { files: next, name: mockFile(path).name, reset };
  }

  return {
    pickFile: () => (params.get("file") === "broken" ? "/mock/broken.json" : "/mock/chosen.json"),
    async invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
      switch (cmd) {
        case "discover_routes":
          return discover(String(args.address));
        case "connect_route_file":
          return connect(String(args.path), args.replaces as string[]);
        case "remove_route_file": {
          const path = String(args.path);
          const reset = paths().filter((file) => file === path);
          files = files.filter((file) => file.path !== path);
          return { files: paths(), name: "", reset };
        }
        case "routes_health":
          return Object.fromEntries(
            files.flatMap((f) => f.routes.map((r) => [r.key, mockHealth(r.target)])),
          );
        default:
          return files;
      }
    },
  };
}

function mockRouted(path: string): RoutedTo | null {
  const enabled = loadEnabledRoutes();
  const pathname = path.split("?")[0];
  const route = MOCK_ROUTE_FILES[0].routes.find(
    (r) => enabled.includes(r.key) && r.path_prefix === pathname,
  );
  return route ? { route_id: route.id, target: route.target } : null;
}

let seq = 1;
let wsSeq = 1;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function jsonBody(obj: unknown) {
  return JSON.stringify(obj);
}

export function generateBatch(): TrafficEvent[] {
  const events: TrafficEvent[] = [];
  const n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const id = seq++;
    const method = pick(METHODS);
    const host = pick(HOSTS);
    const path = pick(PATHS);
    const now = Date.now();
    const hasBody = method !== "GET" && method !== "DELETE";
    events.push({
      type: "ExchangeStarted",
      id,
      request: {
        method,
        url: `https://${host}${path}`,
        host,
        path,
        headers: [
          { name: "host", value: host },
          { name: "authorization", value: "Bearer mock-token" },
          { name: "content-type", value: "application/json" },
        ],
        body: hasBody
          ? {
              mime: "application/json",
              size: 42,
              truncated: false,
              is_binary: false,
              text: jsonBody({ name: "demo", qty: Math.floor(Math.random() * 10) }),
            }
          : null,
        started_at: now,
        routed: mockRouted(path),
      },
    });
    const failed = Math.random() < 0.05;
    if (failed) {
      events.push({ type: "ExchangeFailed", id, error: "connection reset by peer" });
      continue;
    }
    const status = pick(STATUSES);
    const ttfb = 20 + Math.floor(Math.random() * 300);
    const download = Math.floor(Math.random() * 80);
    events.push({
      type: "ExchangeCompleted",
      id,
      response: {
        status,
        headers: [
          { name: "content-type", value: "application/json" },
          { name: "server", value: "mock" },
        ],
        body: {
          mime: "application/json",
          size: 120,
          truncated: false,
          is_binary: false,
          text: jsonBody({ ok: status < 400, data: [{ id: Math.floor(Math.random() * 1000) }], status }),
        },
        ended_at: now + ttfb + download,
      },
      timing: { ttfb_ms: ttfb, download_ms: download, total_ms: ttfb + download },
      protocol: "HTTP/1.1",
    });
  }
  if (Math.random() < 0.3) {
    const connId = 900 + (seq % 5);
    const isNew = wsSeq === 1;
    if (isNew) {
      events.push({
        type: "Ws",
        kind: "Opened",
        id: connId,
        url: "wss://realtime.mock.dev/socket",
        opened_at: Date.now(),
      });
    }
    const frames = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < frames; i++) {
      events.push({
        type: "Ws",
        kind: "Frame",
        id: connId,
        seq: wsSeq++,
        direction: Math.random() < 0.5 ? "Sent" : "Received",
        payload: {
          mime: "text/plain",
          size: 60,
          truncated: false,
          is_binary: false,
          text: jsonBody({ event: "tick", value: Math.floor(Math.random() * 100) }),
        },
        at: Date.now(),
      });
    }
  }
  return events;
}

export function startMock(onBatch: (events: TrafficEvent[]) => void): () => void {
  const timer = setInterval(() => onBatch(generateBatch()), 400);
  return () => clearInterval(timer);
}
