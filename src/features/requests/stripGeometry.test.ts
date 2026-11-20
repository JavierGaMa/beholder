import { describe, expect, it } from "vitest";
import type { HttpExchange } from "../../store/types";
import {
  MAX_WINDOW_S,
  MIN_WINDOW_S,
  axisLabels,
  inWindow,
  severity,
  tickClass,
  tickHeight,
  timeWindow,
  waterfallBar,
  xFraction,
} from "./stripGeometry";

function ex(partial: { id?: number; start?: number; total?: number | null; status?: number | null; error?: string | null }): HttpExchange {
  const { id = 1, start = 0, total = 100, status = 200, error = null } = partial;
  return {
    id,
    request: { method: "GET", url: "https://a.dev/x", host: "a.dev", path: "/x", headers: [], body: null, started_at: start },
    response: status == null ? null : { status, headers: [], body: null, ended_at: start + (total ?? 0) },
    error,
    timing: { ttfb_ms: null, download_ms: null, total_ms: total },
    protocol: "HTTP/1.1",
  };
}

describe("timeWindow", () => {
  it("uses the minimum span when there is no traffic", () => {
    const w = timeWindow([]);
    expect(w.seconds).toBe(MIN_WINDOW_S);
    expect(w.end - w.start).toBe(MIN_WINDOW_S * 1000);
  });

  it("ends at the latest request end", () => {
    const w = timeWindow([ex({ start: 1000, total: 200 }), ex({ start: 5000, total: 1500 })]);
    expect(w.end).toBe(6500);
    expect(w.seconds).toBe(MIN_WINDOW_S);
    expect(w.start).toBe(6500 - MIN_WINDOW_S * 1000);
  });

  it("grows in four second steps to fit the session", () => {
    const w = timeWindow([ex({ start: 0, total: 0 }), ex({ start: 13_000, total: 0 })]);
    expect(w.seconds).toBe(16);
    expect(w.start).toBe(13_000 - 16_000);
  });

  it("caps the span for long sessions", () => {
    const w = timeWindow([ex({ start: 0, total: 0 }), ex({ start: 600_000, total: 0 })]);
    expect(w.seconds).toBe(MAX_WINDOW_S);
    expect(w.start).toBe(600_000 - MAX_WINDOW_S * 1000);
  });

  it("treats pending requests as ending at their start", () => {
    const w = timeWindow([ex({ start: 2000, total: null, status: null })]);
    expect(w.end).toBe(2000);
  });
});

describe("xFraction and inWindow", () => {
  const w = { start: 0, end: 12_000, seconds: 12 };

  it("maps time linearly across the window", () => {
    expect(xFraction(0, w)).toBe(0);
    expect(xFraction(6000, w)).toBe(0.5);
    expect(xFraction(12_000, w)).toBe(1);
  });

  it("clamps outside the window", () => {
    expect(xFraction(-500, w)).toBe(0);
    expect(xFraction(20_000, w)).toBe(1);
  });

  it("includes only requests that start inside the window", () => {
    expect(inWindow(ex({ start: 100 }), w)).toBe(true);
    expect(inWindow(ex({ start: -1 }), w)).toBe(false);
  });
});

describe("tickHeight", () => {
  it("is full height for failed requests", () => {
    expect(tickHeight(ex({ status: null, error: "reset", total: null }))).toBe(1);
    expect(tickHeight(ex({ status: 503, total: 5 }))).toBe(1);
  });

  it("scales with log duration and stays within bounds", () => {
    const short = tickHeight(ex({ total: 10 }));
    const mid = tickHeight(ex({ total: 100 }));
    const long = tickHeight(ex({ total: 1000 }));
    expect(short).toBeLessThan(mid);
    expect(mid).toBeLessThan(long);
    expect(tickHeight(ex({ total: 0 }))).toBeGreaterThan(0);
    expect(tickHeight(ex({ total: 10_000_000 }))).toBe(1);
  });

  it("uses the minimum height for pending requests", () => {
    expect(tickHeight(ex({ status: null, total: null }))).toBe(tickHeight(ex({ total: 1 })));
  });
});

describe("severity and tickClass", () => {
  it("classifies by status", () => {
    expect(severity(ex({ status: 200 }))).toBe("normal");
    expect(severity(ex({ status: 304 }))).toBe("normal");
    expect(severity(ex({ status: 404 }))).toBe("warn");
    expect(severity(ex({ status: 500 }))).toBe("danger");
    expect(severity(ex({ status: null, error: "reset" }))).toBe("danger");
    expect(severity(ex({ status: null }))).toBe("normal");
  });

  it("maps severity to theme colors", () => {
    expect(tickClass("normal")).toContain("bg-muted");
    expect(tickClass("warn")).toContain("bg-warn");
    expect(tickClass("danger")).toContain("bg-danger");
  });
});

describe("waterfallBar", () => {
  const w = { start: 0, end: 10_000, seconds: 10 };

  it("positions by start and duration", () => {
    const bar = waterfallBar(ex({ start: 2000, total: 1000 }), w);
    expect(bar?.left).toBeCloseTo(0.2);
    expect(bar?.width).toBeCloseTo(0.1);
  });

  it("clips requests that began before the window", () => {
    expect(waterfallBar(ex({ start: -1000, total: 2000 }), w)).toEqual({ left: 0, width: 0.1 });
  });

  it("hides requests that ended before the window", () => {
    expect(waterfallBar(ex({ start: -5000, total: 1000 }), w)).toBeNull();
  });

  it("gives pending requests zero width", () => {
    expect(waterfallBar(ex({ start: 5000, total: null, status: null }), w)).toEqual({ left: 0.5, width: 0 });
  });
});

describe("axisLabels", () => {
  it("returns five evenly spaced labels", () => {
    expect(axisLabels({ start: 0, end: 12_000, seconds: 12 })).toEqual(["0s", "3s", "6s", "9s", "12s"]);
    expect(axisLabels({ start: 0, end: 16_000, seconds: 16 })).toEqual(["0s", "4s", "8s", "12s", "16s"]);
  });
});
