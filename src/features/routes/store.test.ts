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

  it("enables every listed route", () => {
    useRoutes.getState().enableAll(["a", "b"]);
    expect(loadEnabledRoutes()).toEqual(["a", "b"]);
    expect(calls).toEqual([["set_all_routes_enabled", { enabled: true }]]);
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
});
