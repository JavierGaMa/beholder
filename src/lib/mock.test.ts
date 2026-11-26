import { describe, expect, it, vi } from "vitest";
import type { DiscoveryResult, RouteFilesUpdate, RouteFileStatus } from "../store/types";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });

const { createRoutesMock } = await import("./mock");

const failure = (p: Promise<unknown>) => p.then(() => null, (e: { kind: string }) => e.kind);

describe("routes mock", () => {
  it("starts empty on request and connects a discovered environment", async () => {
    const mock = createRoutesMock("?routes=empty", 0);
    expect(await mock.invoke("list_routes")).toEqual([]);
    const found = (await mock.invoke("discover_routes", { address: "http://localhost:8090" })) as DiscoveryResult;
    expect(found.files.map((f) => [f.up > 0, f.error !== null])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
    const [dev, staging] = found.files;
    await mock.invoke("connect_route_file", { path: dev.path, replaces: [] });
    const update = (await mock.invoke("connect_route_file", {
      path: staging.path,
      replaces: [dev.path],
    })) as RouteFilesUpdate;
    expect(update.files).toEqual([staging.path]);
    const files = (await mock.invoke("list_routes")) as RouteFileStatus[];
    const health = (await mock.invoke("routes_health")) as Record<string, string>;
    expect(files[0].routes.map((r) => health[r.key])).toEqual(files[0].routes.map(() => "down"));
    await mock.invoke("remove_route_file", { path: staging.path });
    expect(await mock.invoke("list_routes")).toEqual([]);
  });

  it("reaches every failure state", async () => {
    const mock = createRoutesMock("", 0);
    const discover = (address: string) => failure(mock.invoke("discover_routes", { address }));
    expect(await discover("http://localhost:8091")).toBe("invalidResponse");
    expect(await discover("http://localhost:9999")).toBe("unreachable");
    expect(await discover("http://example.com")).toBe("invalidAddress");
    expect(await failure(mock.invoke("connect_route_file", { path: "/mock/broken.json", replaces: [] }))).toBe(
      "invalidFile",
    );
    const locked = createRoutesMock("?config=broken", 0);
    expect(await failure(locked.invoke("connect_route_file", { path: "/mock/a.json", replaces: [] }))).toBe(
      "config",
    );
    expect(createRoutesMock("?file=broken", 0).pickFile()).toBe("/mock/broken.json");
  });
});
