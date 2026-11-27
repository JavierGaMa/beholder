import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { View } from "../../store/traffic";

vi.stubGlobal("window", {});
vi.stubGlobal(
  "localStorage",
  (() => {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  })(),
);

const { CommandBar, FloatingError } = await import("./CommandBar");
const { useTraffic } = await import("../../store/traffic");
const { useRoutes } = await import("../routes/store");
const { routesQueryKey, routesHealthQueryKey } = await import("../../queries/routes");

type TrafficState = ReturnType<typeof useTraffic.getState>;

function setStore(patch: Partial<TrafficState>) {
  useTraffic.setState(patch);
  Object.assign(useTraffic.getInitialState(), patch);
}

function render(client = new QueryClient()) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CommandBar />
    </QueryClientProvider>,
  );
}

const ALL_VIEWS: View[] = [
  "requests",
  "websockets",
  "metrics",
  "emulators",
  "apks",
  "database",
  "console",
  "routes",
];

beforeEach(() => {
  setStore({
    activeView: "requests",
    captureOn: false,
    capturePort: null,
    metro: null,
    targetSerial: null,
    targetAvd: null,
  });
});

describe("CommandBar", () => {
  it("shows the device target, capture control and command field in every view", () => {
    for (const view of ALL_VIEWS) {
      setStore({ activeView: view });
      const html = render();
      expect(html, view).toContain('title="Select target"');
      expect(html, view).toContain(">Capture</button>");
      expect(html, view).toContain("Search or run a command");
    }
  });

  it("disables capture until a running target is selected", () => {
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*title="Select a running target first"/);
    setStore({ targetSerial: "emulator-5554", targetAvd: "Pixel_8_API_35" });
    const html = render();
    expect(html).toContain("Pixel_8_API_35");
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*title="Start capture"/);
  });

  it("replaces the capture button with a live pill and health summary while capturing", () => {
    setStore({
      captureOn: true,
      capturePort: 8080,
      metro: { detected: true, port: 8081 },
      targetSerial: "emulator-5554",
      targetAvd: "Pixel_8_API_35",
    });
    const html = render();
    expect(html).toContain("Capturing");
    expect(html).toContain("00:00");
    expect(html).toContain('aria-label="Stop capture"');
    expect(html).not.toContain(">Capture</button>");
    expect(html).toContain("Proxy :8080, Metro :8081, checking health");
    expect(html).toContain('title="Capture doctor"');
  });

  it("lets the target button shrink so its name truncates instead of overlapping", () => {
    setStore({ targetSerial: "localhost:5555", targetAvd: "sdk gphone64 arm64" });
    const button = render().match(/<button[^>]*title="Select target"[^>]*>/)?.[0] ?? "";
    expect(button).toContain("min-w-0");
    expect(button).not.toContain("shrink-0");
  });

  it("draws the capture error over an opaque background", () => {
    const html = renderToStaticMarkup(<FloatingError message="cannot reach the companion" />);
    expect(html).toContain("bg-[var(--surface-2-solid)]");
    expect(html).toContain("cannot reach the companion");
  });

  it("no longer renders request counters or a sidebar toggle", () => {
    const html = render();
    expect(html).not.toMatch(/\d+ req</);
    expect(html).not.toContain("sidebar");
  });
});

describe("CommandBar local routes chip", () => {
  const route = (id: string) => ({
    key: `/r.json::${id}`,
    id,
    path_prefix: `/v1/${id}`,
    host: null,
    target: "http://127.0.0.1:4000",
    enabled: false,
  });
  const files = [
    { path: "/r.json", name: "local stack", error: null, routes: [route("orders"), route("catalog")] },
  ];

  function renderRoutes(enabled: string[], health: Record<string, "up" | "down">) {
    useRoutes.setState({ enabled });
    Object.assign(useRoutes.getInitialState(), { enabled });
    const client = new QueryClient();
    client.setQueryData(routesQueryKey([]), files);
    client.setQueryData(routesHealthQueryKey(files), health);
    return render(client);
  }

  it("is hidden while every route is disabled", () => {
    expect(renderRoutes([], {})).not.toContain("Local 0/2");
  });

  it("counts the enabled routes", () => {
    const html = renderRoutes(["/r.json::orders"], { "/r.json::orders": "up" });
    expect(html).toContain("Local 1/2");
    expect(html).not.toContain("text-danger");
  });

  it("turns danger when an enabled route is unreachable", () => {
    const html = renderRoutes(["/r.json::orders"], { "/r.json::orders": "down" });
    expect(html).toMatch(/<button[^>]*text-danger[^>]*>Local 1\/2</);
  });
});
