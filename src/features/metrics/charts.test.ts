import { describe, expect, it } from "vitest";
import { buildBarRects, buildLinePath } from "./charts";

describe("buildBarRects", () => {
  it("maps values to baseline-anchored rects scaled to the max", () => {
    const rects = buildBarRects([0, 50, 100], 300, 100);
    expect(rects).toHaveLength(3);
    expect(rects[1].h).toBeCloseTo(50);
    expect(rects[1].y + rects[1].h).toBeCloseTo(100);
    expect(rects[2].h).toBeCloseTo(100);
    expect(rects[2].y).toBeCloseTo(0);
  });

  it("spreads bars across the width with gaps between slots", () => {
    const rects = buildBarRects([10, 10, 10, 10], 400, 100);
    expect(rects[0].x).toBeLessThan(rects[1].x);
    expect(rects[1].x).toBeLessThan(rects[2].x);
    expect(rects[2].x).toBeLessThan(rects[3].x);
    for (const rect of rects) {
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.w).toBeLessThan(400 / 4);
    }
  });

  it("gives zero values zero-height rects at the baseline", () => {
    const rects = buildBarRects([0, 0], 100, 100);
    for (const rect of rects) {
      expect(rect.h).toBe(0);
      expect(rect.y).toBe(100);
    }
  });

  it("returns an empty list for empty input", () => {
    expect(buildBarRects([], 100, 100)).toEqual([]);
  });

  it("never emits NaN or Infinity", () => {
    const rects = buildBarRects([0, 7, 3], 120, 60);
    for (const rect of rects) {
      for (const n of [rect.x, rect.y, rect.w, rect.h]) {
        expect(Number.isFinite(n)).toBe(true);
      }
    }
  });
});

describe("buildLinePath", () => {
  it("maps values to a polyline path scaled to the max", () => {
    const path = buildLinePath([0, 100], 100, 50);
    expect(path).toBe("M 0 50 L 100 0");
  });

  it("sorts nothing: values are plotted in input order", () => {
    const path = buildLinePath([100, 0], 100, 50);
    expect(path).toBe("M 0 0 L 100 50");
  });

  it("renders a flat line for a single value", () => {
    const path = buildLinePath([42], 100, 50);
    expect(path).toBe("M 0 0 L 100 0");
  });

  it("returns an empty string for empty input", () => {
    expect(buildLinePath([], 100, 50)).toBe("");
  });

  it("keeps an all-zero series on the baseline", () => {
    const path = buildLinePath([0, 0, 0], 90, 30);
    expect(path).toBe("M 0 30 L 45 30 L 90 30");
  });
});
