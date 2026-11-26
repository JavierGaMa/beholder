import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RouteFileStatus, TrafficEvent } from "../../store/types";

vi.stubGlobal("window", {});
vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

const { RoutesView } = await import("./RoutesView");
const { useRoutes } = await import("./store");
const { useTraffic } = await import("../../store/traffic");
const { routesQueryKey, routesHealthQueryKey } = await import("../../queries/routes");

const files: RouteFileStatus[] = [
  {
    path: "/stack/routes.json",
    name: "local stack",
    error: null,
    routes: [
      {
        key: "/stack/routes.json::orders",
        id: "orders",
        path_prefix: "/v1/orders",
        host: null,
        target: "http://127.0.0.1:4000",
        enabled: false,
      },
      {
        key: "/stack/routes.json::catalog",
        id: "catalog",
        path_prefix: "/v1/catalog",
        host: "api.example.com",
        target: "http://127.0.0.1:4001",
        enabled: false,
      },
    ],
  },
  {
    path: "/stack/broken.json",
    name: "broken.json",
    error: "unsupported route file version 2 (supported: 1)",
    routes: [],
  },
];

const routed: TrafficEvent = {
  type: "ExchangeStarted",
  id: 1,
  request: {
    method: "GET",
    url: "https://api.example.com/v1/orders",
    host: "api.example.com",
    path: "/v1/orders",
    headers: [],
    body: null,
    started_at: 1,
    routed: { route_id: "orders", target: "http://127.0.0.1:4000" },
  },
};

function patch<S>(store: { setState: (p: Partial<S>) => void; getInitialState: () => S }, p: Partial<S>) {
  store.setState(p);
  Object.assign(store.getInitialState() as object, p);
}

function render(data: RouteFileStatus[], health: Record<string, "up" | "down"> = {}) {
  const client = new QueryClient();
  client.setQueryData(routesQueryKey([]), data);
  client.setQueryData(routesHealthQueryKey(data), health);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RoutesView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useTraffic.getState().clear();
  patch(useTraffic, { routedHits: new Map() });
  patch(useRoutes, { enabled: [] });
});

describe("RoutesView", () => {
  it("explains the config section when no route file is configured", () => {
    const html = render([]);
    expect(html).toContain("Route requests to local services");
    expect(html).toContain("[routes]");
    expect(html).toContain("Copy config snippet");
    expect(html).toContain("Open config.toml");
    expect(html).not.toContain("Enable all");
  });

  it("groups routes by file and shows parse errors", () => {
    const html = render(files);
    expect(html).toContain("local stack");
    expect(html).toContain("/stack/routes.json");
    expect(html).toContain("2 routes");
    expect(html).toContain("0 routes");
    expect(html).toContain("unsupported route file version 2 (supported: 1)");
    expect(html).toContain("/v1/orders");
    expect(html).toContain("http://127.0.0.1:4000");
    expect(html).toContain("api.example.com");
    expect(html).toContain("Enable all");
    expect(html).toContain("Disable all");
    expect(html.match(/>Reload</g)).toHaveLength(2);
    expect(html.match(/role="switch" aria-checked="false"/g)).toHaveLength(2);
    expect(html.match(/>Off</g)).toHaveLength(2);
  });

  it("summarizes enabled, rerouted and unreachable routes with hit counts", () => {
    useTraffic.getState().ingest([routed]);
    patch(useTraffic, { routedHits: useTraffic.getState().routedHits });
    patch(useRoutes, {
      enabled: ["/stack/routes.json::orders", "/stack/routes.json::catalog"],
    });
    const html = render(files, {
      "/stack/routes.json::orders": "up",
      "/stack/routes.json::catalog": "down",
    });
    expect(html).toMatch(/Local routes<\/span><span[^>]*>2\/2</);
    expect(html).toMatch(/Rerouted requests<\/span><span[^>]*>1</);
    expect(html).toMatch(/Unreachable<\/span><span[^>]*>1</);
    expect(html).toContain(">Healthy<");
    expect(html).toContain("1 hit<");
    expect(html).toContain("0 hits<");
  });
});
