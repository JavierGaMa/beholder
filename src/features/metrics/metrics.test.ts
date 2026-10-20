import { describe, expect, it } from "vitest";
import type { HttpExchange } from "../../store/types";
import { computeMetrics } from "./metrics";

let nextId = 1;

interface Fixture {
  host?: string;
  method?: string;
  status?: number;
  noResponse?: boolean;
  inBytes?: number;
  outBytes?: number;
  startedAt?: number;
  ttfb?: number | null;
  total?: number | null;
  error?: string;
}

function ex(f: Fixture = {}): HttpExchange {
  const startedAt = f.startedAt ?? 1_000;
  return {
    id: nextId++,
    request: {
      method: f.method ?? "GET",
      url: `https://${f.host ?? "api.example.com"}/path`,
      host: f.host ?? "api.example.com",
      path: "/path",
      headers: [],
      body:
        f.inBytes == null
          ? undefined
          : { mime: null, size: f.inBytes, truncated: false, text: "", is_binary: false },
      started_at: startedAt,
    },
    response:
      f.noResponse || (f.status == null && f.outBytes == null)
        ? undefined
        : {
            status: f.status ?? 200,
            headers: [],
            body:
              f.outBytes == null
                ? undefined
                : { mime: null, size: f.outBytes, truncated: false, text: "", is_binary: false },
            ended_at: startedAt + (f.total ?? 10),
          },
    error: f.error,
    timing: { ttfb_ms: f.ttfb ?? null, download_ms: null, total_ms: f.total ?? null },
    protocol: "h2",
  };
}

describe("computeMetrics totals", () => {
  it("returns a zeroed structure for empty input", () => {
    expect(computeMetrics([])).toEqual({
      totals: {
        count: 0,
        failed: 0,
        bytesIn: 0,
        bytesOut: 0,
        p50Ms: null,
        p95Ms: null,
        avgTtfbMs: null,
      },
      byDomain: [],
      buckets: [],
      slowest: [],
    });
  });

  it("sums bytes in and out and counts failures", () => {
    const m = computeMetrics([
      ex({ outBytes: 100, inBytes: 10, total: 50, ttfb: 20 }),
      ex({ status: 500, outBytes: 30, total: 80 }),
      ex({ error: "timeout", total: 10 }),
      ex({ total: 20, ttfb: 40 }),
    ]);
    expect(m.totals.count).toBe(4);
    expect(m.totals.failed).toBe(2);
    expect(m.totals.bytesIn).toBe(130);
    expect(m.totals.bytesOut).toBe(10);
  });

  it("handles missing bodies and null timings without NaN", () => {
    const m = computeMetrics([ex({ noResponse: true, total: 10 }), ex({ total: 20 })]);
    expect(m.totals.bytesIn).toBe(0);
    expect(m.totals.bytesOut).toBe(0);
    expect(m.totals.p50Ms).toBe(10);
    expect(m.totals.p95Ms).toBe(20);
  });

  it("computes percentiles excluding null timings", () => {
    const m = computeMetrics([
      ex({ total: 100 }),
      ex({ total: null }),
      ex({ total: 200 }),
      ex({ total: 300 }),
    ]);
    expect(m.totals.p50Ms).toBe(200);
    expect(m.totals.p95Ms).toBe(300);
  });

  it("averages non-null ttfb values only", () => {
    const m = computeMetrics([
      ex({ ttfb: 10, total: 5 }),
      ex({ ttfb: null, total: 5 }),
      ex({ ttfb: 30, total: 5 }),
    ]);
    expect(m.totals.avgTtfbMs).toBe(20);
  });

  it("returns null percentiles when every timing is null", () => {
    const m = computeMetrics([ex({ total: null, ttfb: null }), ex({ total: null })]);
    expect(m.totals.p50Ms).toBeNull();
    expect(m.totals.p95Ms).toBeNull();
    expect(m.totals.avgTtfbMs).toBeNull();
  });
});

describe("computeMetrics byDomain", () => {
  it("groups by host ordered by bytesIn desc", () => {
    const m = computeMetrics([
      ex({ host: "small.com", outBytes: 10, total: 10 }),
      ex({ host: "big.com", outBytes: 500, total: 100 }),
      ex({ host: "big.com", outBytes: 100, total: 200 }),
    ]);
    expect(m.byDomain).toHaveLength(2);
    expect(m.byDomain[0].host).toBe("big.com");
    expect(m.byDomain[0].bytesIn).toBe(600);
    expect(m.byDomain[0].count).toBe(2);
    expect(m.byDomain[1].host).toBe("small.com");
  });

  it("breaks bytesIn ties by host name", () => {
    const m = computeMetrics([
      ex({ host: "zeta.com", outBytes: 50, total: 5 }),
      ex({ host: "alpha.com", outBytes: 50, total: 5 }),
    ]);
    expect(m.byDomain[0].host).toBe("alpha.com");
    expect(m.byDomain[1].host).toBe("zeta.com");
  });

  it("caps the domain list at 10 entries", () => {
    const hosts = Array.from({ length: 12 }, (_, i) => `host${i}.com`);
    const m = computeMetrics(hosts.map((host, i) => ex({ host, outBytes: i + 1, total: 5 })));
    expect(m.byDomain).toHaveLength(10);
    expect(m.byDomain[0].host).toBe("host11.com");
  });

  it("tracks per-domain failed count and p95", () => {
    const m = computeMetrics([
      ex({ host: "api.com", total: 100 }),
      ex({ host: "api.com", status: 404, total: 300 }),
    ]);
    expect(m.byDomain[0].failed).toBe(1);
    expect(m.byDomain[0].p95Ms).toBe(300);
  });
});

describe("computeMetrics buckets", () => {
  it("produces 60 buckets and clamps the max timestamp into the last one", () => {
    const m = computeMetrics([
      ex({ startedAt: 0, outBytes: 10, total: 1 }),
      ex({ startedAt: 1_500, outBytes: 20, total: 1 }),
      ex({ startedAt: 60_000, outBytes: 40, total: 1 }),
    ]);
    expect(m.buckets).toHaveLength(60);
    expect(m.buckets[0].count).toBe(1);
    expect(m.buckets[0].bytesIn).toBe(10);
    expect(m.buckets[1].count).toBe(1);
    expect(m.buckets[1].bytesIn).toBe(20);
    expect(m.buckets[59].count).toBe(1);
    expect(m.buckets[59].bytesIn).toBe(40);
  });

  it("collapses to the first bucket when all timestamps are equal", () => {
    const m = computeMetrics([
      ex({ startedAt: 5_000, outBytes: 10, total: 1 }),
      ex({ startedAt: 5_000, outBytes: 20, total: 1 }),
    ]);
    expect(m.buckets[0].count).toBe(2);
    expect(m.buckets[0].bytesIn).toBe(30);
    expect(m.buckets.slice(1).every((b) => b.count === 0)).toBe(true);
  });
});

describe("computeMetrics slowest", () => {
  it("returns the top 5 exchanges by total_ms excluding nulls", () => {
    const m = computeMetrics([
      ex({ total: 10 }),
      ex({ total: 500 }),
      ex({ total: null }),
      ex({ total: 300 }),
      ex({ total: 400 }),
      ex({ total: 200 }),
      ex({ total: 100 }),
      ex({ total: 50 }),
    ]);
    expect(m.slowest).toHaveLength(5);
    expect(m.slowest.map((e) => e.timing.total_ms)).toEqual([500, 400, 300, 200, 100]);
  });
});
