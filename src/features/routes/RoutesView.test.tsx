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
const { useConnect } = await import("./connectStore");
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
  patch(useConnect, { banner: null });
});

describe("RoutesView", () => {
  it("invites to connect services when no route file is configured", () => {
    const html = render([]);
    expect(html).toContain("Send app traffic to your local services");
    expect(html).toContain(
      "Pick the endpoints you&#x27;re working on and Beholder sends them to your machine. Everything else keeps going to the real server.",
    );
    expect(html).toContain("Beholder looks for a local stack on localhost. Nothing leaves your machine.");
    expect(html).toContain(">Connect services<");
    expect(html).toContain(">Choose file…<");
    expect(html).not.toContain("[routes]");
    expect(html).not.toContain("Enable all");
    expect(html).not.toContain("No rerouted requests yet");
  });

  it("offers to connect, choose and remove files from the list", () => {
    const html = render(files);
    expect(html).toContain(">Connect services<");
    expect(html).toContain(">Choose file…<");
    expect(html.match(/>Remove</g)).toHaveLength(2);
    expect(html).toContain('aria-label="Remove local stack"');
  });

  it("shows whether disabled routes are ready to be enabled", () => {
    const html = render(files, {
      "/stack/routes.json::orders": "up",
      "/stack/routes.json::catalog": "down",
    });
    expect(html).toContain(">Ready<");
    expect(html).toContain(">Not running<");
    expect(html).not.toContain(">Off<");
  });

  it("hints how to see traffic until a request is rerouted", () => {
    const html = render(files);
    expect(html).toContain("No rerouted requests yet");
    expect(html).toContain("Turn on a route above, start a capture and use your app.");
    useTraffic.getState().ingest([routed]);
    patch(useTraffic, { routedHits: useTraffic.getState().routedHits });
    expect(render(files)).not.toContain("No rerouted requests yet");
  });

  it("shows the connected banner until dismissed", () => {
    const banner = "Connected to local stack Dev. Turn on the services you want to use locally.";
    expect(render(files)).not.toContain(banner);
    patch(useConnect, { banner });
    const html = render(files);
    expect(html).toContain(banner);
    expect(html).toContain(">Got it<");
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
    expect(html.match(/>Checking</g)).toHaveLength(2);
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
