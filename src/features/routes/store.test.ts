import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as [string, unknown][]);
vi.mock("../../lib/tauri", () => ({
  isTauri: false,
  invoke: (cmd: string, args?: unknown) => {
    calls.push([cmd, args]);
    return Promise.resolve();
  },
}));
const storage = vi.hoisted(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
});

const { useRoutes } = await import("./store");
const { loadEnabledRoutes } = await import("../../lib/prefs");

const twins = ["mx", "br"].map((country) => ({
  path: `/${country}.json`,
  name: country,
  error: null,
  routes: [
    {
      key: `/${country}.json::orders`,
      id: "orders",
      path_prefix: "/v1/orders",
      host: null,
      target: "http://127.0.0.1:4000",
      enabled: false,
    },
  ],
}));

beforeEach(() => {
  calls.length = 0;
  storage.clear();
  useRoutes.setState({ enabled: [] });
});

describe("routes store", () => {
  it("starts with every route disabled", () => {
    expect(loadEnabledRoutes()).toEqual([]);
  });

  it("ignores unreadable persisted state", () => {
    storage.set("beholder.enabledRoutes", "{nope");
    expect(loadEnabledRoutes()).toEqual([]);
    storage.set("beholder.enabledRoutes", '{"a":1}');
    expect(loadEnabledRoutes()).toEqual([]);
  });

  it("persists a toggle and pushes it to the backend", () => {
    useRoutes.getState().setEnabled("/a.json::orders", true);
    expect(useRoutes.getState().enabled).toEqual(["/a.json::orders"]);
    expect(loadEnabledRoutes()).toEqual(["/a.json::orders"]);
    useRoutes.getState().setEnabled("/a.json::orders", false);
    expect(loadEnabledRoutes()).toEqual([]);
    expect(calls).toEqual([
      ["set_route_enabled", { key: "/a.json::orders", enabled: true }],
      ["set_route_enabled", { key: "/a.json::orders", enabled: false }],
    ]);
  });

  it("enables every listed route that does not conflict", () => {
    useRoutes.getState().enableAll(twins);
    expect(loadEnabledRoutes()).toEqual(["/mx.json::orders"]);
    expect(calls).toEqual([["set_route_enabled", { key: "/mx.json::orders", enabled: true }]]);
  });

  it("switches off the conflicting route when another is enabled", () => {
    useRoutes.setState({ enabled: ["/mx.json::orders"] });
    useRoutes.getState().setEnabled("/br.json::orders", true, twins);
    expect(loadEnabledRoutes()).toEqual(["/br.json::orders"]);
    expect(calls).toEqual([
      ["set_route_enabled", { key: "/mx.json::orders", enabled: false }],
      ["set_route_enabled", { key: "/br.json::orders", enabled: true }],
    ]);
  });

  it("drops persisted conflicts, keeping the one the proxy would use", () => {
    useRoutes.setState({ enabled: ["/br.json::orders", "/mx.json::orders"] });
    useRoutes.getState().reconcile(twins);
    expect(loadEnabledRoutes()).toEqual(["/mx.json::orders"]);
    expect(calls).toEqual([["set_route_enabled", { key: "/br.json::orders", enabled: false }]]);
  });

  it("disables every route including stale ones", () => {
    useRoutes.setState({ enabled: ["a", "stale"] });
    useRoutes.getState().disableAll();
    expect(useRoutes.getState().enabled).toEqual([]);
    expect(loadEnabledRoutes()).toEqual([]);
    expect(calls).toEqual([["set_all_routes_enabled", { enabled: false }]]);
  });

  it("pushes persisted toggles to the backend on sync", () => {
    useRoutes.setState({ enabled: ["a", "b"] });
    useRoutes.getState().sync();
    expect(calls).toEqual([
      ["set_route_enabled", { key: "a", enabled: true }],
      ["set_route_enabled", { key: "b", enabled: true }],
    ]);
  });

  it("forgets every route of the given files", () => {
    useRoutes.setState({ enabled: ["/a.json::x", "/a.json.bak::x", "/b.json::y"] });
    useRoutes.getState().forget(["/a.json"]);
    expect(useRoutes.getState().enabled).toEqual(["/a.json.bak::x", "/b.json::y"]);
    expect(loadEnabledRoutes()).toEqual(["/a.json.bak::x", "/b.json::y"]);
    expect(calls).toEqual([["set_route_enabled", { key: "/a.json::x", enabled: false }]]);
  });
});
