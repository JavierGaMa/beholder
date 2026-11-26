import { describe, expect, it } from "vitest";
import { activeFilterCount, isFailed, isSlow, matchFilters, quickCounts, quickModeOf, withQuickMode, type Filters } from "./filters";
import type { HttpExchange } from "../../store/types";

const base: Filters = {
  text: "",
  status: "all",
  method: "",
  failuresOnly: false,
  slowOnly: false,
  inBodies: false,
  includeDomains: [],
  excludeDomains: [],
  localOnly: false,
};

function ex(partial: {
  host?: string;
  path?: string;
  method?: string;
  status?: number | null;
  error?: string | null;
  total?: number | null;
  reqBody?: string;
  resBody?: string;
}): HttpExchange {
  const { host = "a.dev", path = "/x", method = "GET", status = 200, error = null, total = 100, reqBody, resBody } = partial;
  return {
    id: 1,
    request: {
      method,
      url: `https://${host}${path}`,
      host,
      path,
      headers: [],
      body: reqBody != null ? { mime: "application/json", size: reqBody.length, truncated: false, is_binary: false, text: reqBody } : null,
      started_at: 0,
    },
    response:
      status == null
        ? null
        : {
            status,
            headers: [],
            body: resBody != null ? { mime: "application/json", size: resBody.length, truncated: false, is_binary: false, text: resBody } : null,
            ended_at: 1,
          },
    error,
    timing: { ttfb_ms: null, download_ms: null, total_ms: total },
    protocol: "HTTP/1.1",
  };
}

describe("matchFilters", () => {
  it("matches text on host and path", () => {
    expect(matchFilters(ex({ host: "api.dev", path: "/users" }), { ...base, text: "api" })).toBe(true);
    expect(matchFilters(ex({ host: "api.dev", path: "/users" }), { ...base, text: "orders" })).toBe(false);
    expect(matchFilters(ex({ host: "api.dev", path: "/users" }), { ...base, text: "users" })).toBe(true);
  });

  it("matches status class", () => {
    expect(matchFilters(ex({ status: 404 }), { ...base, status: "4xx" })).toBe(true);
    expect(matchFilters(ex({ status: 404 }), { ...base, status: "2xx" })).toBe(false);
  });

  it("pending exchanges fail status filters but pass base", () => {
    expect(matchFilters(ex({ status: null }), { ...base, status: "2xx" })).toBe(false);
    expect(matchFilters(ex({ status: null }), base)).toBe(true);
  });

  it("matches method case-insensitive", () => {
    expect(matchFilters(ex({ method: "POST" }), { ...base, method: "post" })).toBe(true);
  });

  it("failuresOnly keeps 4xx/5xx and errors", () => {
    expect(matchFilters(ex({ status: 500 }), { ...base, failuresOnly: true })).toBe(true);
    expect(matchFilters(ex({ status: 200 }), { ...base, failuresOnly: true })).toBe(false);
    expect(matchFilters(ex({ status: null, error: "reset" }), { ...base, failuresOnly: true })).toBe(true);
  });

  it("slowOnly keeps requests over threshold", () => {
    expect(matchFilters(ex({ total: 800 }), { ...base, slowOnly: true }, 500)).toBe(true);
    expect(matchFilters(ex({ total: 400 }), { ...base, slowOnly: true }, 500)).toBe(false);
    expect(matchFilters(ex({ total: null }), { ...base, slowOnly: true }, 500)).toBe(false);
  });

  it("includeDomains restricts to selected hosts", () => {
    expect(matchFilters(ex({ host: "api.dev" }), { ...base, includeDomains: ["api.dev"] })).toBe(true);
    expect(matchFilters(ex({ host: "cdn.dev" }), { ...base, includeDomains: ["api.dev"] })).toBe(false);
  });

  it("excludeDomains hides noisy hosts", () => {
    expect(matchFilters(ex({ host: "crashlytics.com" }), { ...base, excludeDomains: ["crashlytics.com"] })).toBe(false);
    expect(matchFilters(ex({ host: "api.dev" }), { ...base, excludeDomains: ["crashlytics.com"] })).toBe(true);
  });

  it("inBodies searches request and response content", () => {
    const f = { ...base, text: "sessionToken", inBodies: true };
    expect(matchFilters(ex({ resBody: '{"sessionToken":"abc"}' }), f)).toBe(true);
    expect(matchFilters(ex({ reqBody: '{"refresh":"sessionToken"}' }), f)).toBe(true);
    expect(matchFilters(ex({ resBody: '{"other":1}' }), f)).toBe(false);
    expect(matchFilters(ex({ path: "/sessionToken" }), { ...base, text: "sessionToken" })).toBe(true);
    expect(matchFilters(ex({ resBody: '{"sessionToken":1}' }), { ...base, text: "sessionToken" })).toBe(false);
  });
});

describe("isFailed", () => {
  it("treats transport errors as failures", () => {
    expect(isFailed(ex({ status: 200, error: "boom" }))).toBe(true);
    expect(isFailed(ex({ status: 502 }))).toBe(true);
    expect(isFailed(ex({ status: 302 }))).toBe(false);
  });
});

describe("activeFilterCount", () => {
  it("returns zero for default filters", () => {
    expect(activeFilterCount(base)).toBe(0);
  });

  it("counts each non-default facet once", () => {
    const f: Filters = {
      ...base,
      status: "4xx",
      method: "get",
      failuresOnly: true,
      slowOnly: true,
      inBodies: true,
    };
    expect(activeFilterCount(f)).toBe(5);
  });

  it("counts domain lists as single facets regardless of length", () => {
    expect(activeFilterCount({ ...base, includeDomains: ["a.dev", "b.dev"] })).toBe(1);
    expect(activeFilterCount({ ...base, excludeDomains: ["x.dev"] })).toBe(1);
    expect(activeFilterCount({ ...base, includeDomains: ["a.dev"], excludeDomains: ["x.dev"] })).toBe(2);
  });

  it("ignores search text since it is visible in the toolbar input", () => {
    expect(activeFilterCount({ ...base, text: "api" })).toBe(0);
  });
});

describe("quick modes", () => {
  it("derives the mode from the existing failure and slow flags", () => {
    expect(quickModeOf(base)).toBe("all");
    expect(quickModeOf({ ...base, failuresOnly: true })).toBe("errors");
    expect(quickModeOf({ ...base, slowOnly: true })).toBe("slow");
    expect(quickModeOf({ ...base, failuresOnly: true, slowOnly: true })).toBe("custom");
  });

  it("sets exactly one flag per mode and keeps other facets", () => {
    const f = { ...base, text: "api", failuresOnly: true, slowOnly: true };
    expect(withQuickMode(f, "all")).toEqual({ ...f, failuresOnly: false, slowOnly: false });
    expect(withQuickMode(f, "errors")).toEqual({ ...f, failuresOnly: true, slowOnly: false });
    expect(withQuickMode(f, "slow")).toEqual({ ...f, failuresOnly: false, slowOnly: true });
  });

  it("isSlow matches the slowOnly filter threshold", () => {
    expect(isSlow(ex({ total: 500 }), 500)).toBe(true);
    expect(isSlow(ex({ total: 499 }), 500)).toBe(false);
    expect(isSlow(ex({ total: null }), 500)).toBe(false);
  });

  it("counts each mode under the other active filters, ignoring the current mode", () => {
    const all = [
      ex({ host: "api.dev", status: 200, total: 100 }),
      ex({ host: "api.dev", status: 500, total: 900 }),
      ex({ host: "api.dev", status: null, error: "reset", total: null }),
      ex({ host: "api.dev", status: 200, total: 800 }),
      ex({ host: "cdn.dev", status: 404, total: 50 }),
    ];
    expect(quickCounts(all, base, 500)).toEqual({ all: 5, errors: 3, slow: 2 });
    expect(quickCounts(all, { ...base, failuresOnly: true, includeDomains: ["api.dev"] }, 500)).toEqual({
      all: 4,
      errors: 2,
      slow: 2,
    });
  });
});

describe("localOnly", () => {
  const plain = ex({});
  const routed: HttpExchange = {
    ...plain,
    request: { ...plain.request, routed: { route_id: "orders", target: "http://127.0.0.1:4000" } },
  };

  it("keeps only routed requests", () => {
    expect(matchFilters(routed, { ...base, localOnly: true })).toBe(true);
    expect(matchFilters(plain, { ...base, localOnly: true })).toBe(false);
    expect(
      matchFilters({ ...plain, request: { ...plain.request, routed: null } }, { ...base, localOnly: true }),
    ).toBe(false);
  });

  it("leaves every request visible when off", () => {
    expect(matchFilters(routed, base)).toBe(true);
    expect(matchFilters(plain, base)).toBe(true);
  });

  it("counts as an active filter and scopes the quick counts", () => {
    expect(activeFilterCount({ ...base, localOnly: true })).toBe(1);
    expect(quickCounts([plain, routed], { ...base, localOnly: true }).all).toBe(1);
  });
});
