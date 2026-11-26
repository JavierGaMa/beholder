import { describe, expect, it } from "vitest";
import {
  CONFIG_SNIPPET,
  hitKey,
  routePill,
  summarizeRoutes,
  totalHits,
  withRoutesEnabled,
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
  it("is off for a disabled route whatever its health", () => {
    expect(routePill(false, "up")).toBe("off");
    expect(routePill(false, "down")).toBe("off");
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

describe("config snippet", () => {
  it("shows the routes section with an absolute path", () => {
    expect(CONFIG_SNIPPET).toBe('[routes]\nfiles = ["/abs/path/routes.json"]\n');
  });
});
