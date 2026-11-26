import type { RouteFileStatus, RouteHealth, RoutedTo, TrafficEvent } from "../store/types";
import { loadEnabledRoutes } from "./prefs";

const HOSTS = ["api.mock.dev", "cdn.mock.dev", "auth.mock.dev", "graphql.mock.dev"];
const PATHS = ["/v1/users", "/v1/orders", "/v1/session", "/graphql", "/v1/items?page=2", "/health"];
const METHODS = ["GET", "GET", "GET", "POST", "PUT", "DELETE"];
const STATUSES = [200, 200, 200, 201, 204, 304, 400, 404, 500];

const MOCK_ROUTES_PATH = "/mock/routes.json";

function mockRoute(id: string, port: number) {
  return {
    key: `${MOCK_ROUTES_PATH}::${id}`,
    id,
    path_prefix: `/v1/${id}`,
    host: null,
    target: `http://127.0.0.1:${port}`,
    enabled: false,
  };
}

export const MOCK_ROUTE_FILES: RouteFileStatus[] = [
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

export const MOCK_ROUTE_HEALTH: Record<string, RouteHealth> = Object.fromEntries(
  MOCK_ROUTE_FILES[0].routes.map((r) => [r.key, r.id === "items" ? "down" : "up"]),
);

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
