import { describe, expect, it } from "vitest";
import { isFailed, matchFilters, type Filters } from "./filters";
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
