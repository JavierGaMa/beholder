import { describe, expect, it } from "vitest";
import { matchFilters, type Filters } from "./filters";
import type { HttpExchange } from "../../store/types";

const base: Filters = { text: "", status: "all", method: "" };

function ex(partial: Partial<HttpExchange> & { host?: string; path?: string; method?: string; status?: number | null }): HttpExchange {
  const { host = "a.dev", path = "/x", method = "GET", status = 200, ...rest } = partial;
  return {
    id: 1,
    request: {
      method,
      url: `https://${host}${path}`,
      host,
      path,
      headers: [],
      body: null,
      started_at: 0,
    },
    response:
      status == null
        ? null
        : {
            status,
            headers: [],
            body: null,
            ended_at: 1,
          },
    error: null,
    timing: { ttfb_ms: null, download_ms: null, total_ms: null },
    protocol: "HTTP/1.1",
    ...rest,
  };
}

describe("matchFilters", () => {
  it("matches text on host", () => {
    expect(matchFilters(ex({ host: "api.dev" }), { ...base, text: "api" })).toBe(true);
    expect(matchFilters(ex({ host: "api.dev" }), { ...base, text: "cdn" })).toBe(false);
  });

  it("matches status class", () => {
    expect(matchFilters(ex({ status: 404 }), { ...base, status: "4xx" })).toBe(true);
    expect(matchFilters(ex({ status: 404 }), { ...base, status: "2xx" })).toBe(false);
  });

  it("pending exchanges fail status filters", () => {
    expect(matchFilters(ex({ status: null }), { ...base, status: "2xx" })).toBe(false);
    expect(matchFilters(ex({ status: null }), base)).toBe(true);
  });

  it("matches method case-insensitive", () => {
    expect(matchFilters(ex({ method: "POST" }), { ...base, method: "post" })).toBe(true);
  });
});
