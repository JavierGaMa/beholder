import { describe, expect, it } from "vitest";
import {
  hitKey,
  routePill,
  summarizeRoutes,
  totalHits,
  withRoutesEnabled,
  enableRoutes,
} from "./routes";
import type { RouteFileStatus } from "../../store/types";

const route = (key: string, port: number) => ({
  key,
  id: key.split("::")[1],
  path_prefix: `/v1/${key.split("::")[1]}`,
  host: null,
  target: `http://127.0.0.1:${port}`,
  enabled: false,
});

const files: RouteFileStatus[] = [
  {
    path: "/a.json",
    name: "local stack",
    error: null,
    routes: [route("/a.json::orders", 4000), route("/a.json::catalog", 4001)],
  },
  { path: "/b.json", name: "b.json", error: "invalid route file", routes: [] },
  { path: "/c.json", name: "other", error: null, routes: [route("/c.json::profile", 4002)] },
];

describe("summarizeRoutes", () => {
  it("counts enabled routes over the loaded total, ignoring unknown keys", () => {
    const summary = summarizeRoutes(files, ["/a.json::orders", "/gone.json::x"], {});
    expect(summary).toEqual({ total: 3, enabled: 1, unreachable: 0 });
  });

  it("counts only enabled routes whose target is down as unreachable", () => {
    const summary = summarizeRoutes(files, ["/a.json::orders", "/c.json::profile"], {
      "/a.json::orders": "down",
      "/a.json::catalog": "down",
      "/c.json::profile": "up",
    });
    expect(summary.unreachable).toBe(1);
  });
});

describe("routePill", () => {
  it("tells whether a disabled route is ready to be enabled", () => {
    expect(routePill(false, "up")).toBe("ready");
    expect(routePill(false, "down")).toBe("stopped");
    expect(routePill(false, undefined)).toBe("checking");
  });

  it("reflects health for an enabled route", () => {
    expect(routePill(true, "up")).toBe("healthy");
    expect(routePill(true, "down")).toBe("unreachable");
    expect(routePill(true, undefined)).toBe("checking");
  });
});

describe("hit counting", () => {
  it("keys hits by route id and target, ignoring a trailing slash", () => {
    expect(hitKey("orders", "http://127.0.0.1:4000/")).toBe(
      hitKey("orders", "http://127.0.0.1:4000"),
    );
    expect(hitKey("orders", "http://127.0.0.1:4000")).not.toBe(
      hitKey("orders", "http://127.0.0.1:4001"),
    );
  });

  it("totals every route hit", () => {
    expect(totalHits(new Map())).toBe(0);
    expect(
      totalHits(
        new Map([
          ["a", 2],
          ["b", 3],
        ]),
      ),
    ).toBe(5);
  });
});

describe("withRoutesEnabled", () => {
  it("adds keys once and removes them", () => {
    expect(withRoutesEnabled(["a"], ["a", "b"], true)).toEqual(["a", "b"]);
    expect(withRoutesEnabled(["a", "b"], ["a"], false)).toEqual(["b"]);
  });
});

describe("enableRoutes", () => {
  const twin = (path: string, prefix: string, host: string | null = null) => ({
    ...route(`${path}::orders`, 4000),
    path_prefix: prefix,
    host,
  });
  const file = (path: string, prefix: string, host: string | null = null): RouteFileStatus => ({
    path,
    name: path,
    error: null,
    routes: [twin(path, prefix, host)],
  });
  const same = [file("/mx.json", "/v1/Orders"), file("/br.json", "/v1/orders")];

  it("replaces an enabled route that matches the same host and prefix", () => {
    expect(enableRoutes(["/mx.json::orders"], same, ["/br.json::orders"])).toEqual([
      "/br.json::orders",
    ]);
  });

  it("keeps routes with a different host", () => {
    const hosts = [file("/a.json", "/v1/orders", "a.test"), file("/b.json", "/v1/orders", "b.test")];
    expect(enableRoutes(["/a.json::orders"], hosts, ["/b.json::orders"])).toEqual([
      "/a.json::orders",
      "/b.json::orders",
    ]);
  });

  it("enables only the first of conflicting routes when enabling all", () => {
    const keys = ["/mx.json::orders", "/br.json::orders"];
    expect(enableRoutes([], same, keys, "keep")).toEqual(["/mx.json::orders"]);
    expect(enableRoutes(["/br.json::orders"], same, keys, "keep")).toEqual(["/br.json::orders"]);
  });

  it("keeps unknown keys", () => {
    expect(enableRoutes(["/gone.json::x"], same, ["/mx.json::orders"])).toEqual([
      "/gone.json::x",
      "/mx.json::orders",
    ]);
  });
});
