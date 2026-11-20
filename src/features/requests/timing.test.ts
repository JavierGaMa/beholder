import { describe, expect, it } from "vitest";
import { timingPhases } from "./timing";

describe("timingPhases", () => {
  it("splits total into ttfb and download", () => {
    expect(timingPhases({ ttfb_ms: 120, download_ms: 30, total_ms: 150 })).toEqual([
      { label: "TTFB", ms: 120 },
      { label: "Download", ms: 30 },
    ]);
  });

  it("adds the unaccounted remainder as other", () => {
    expect(timingPhases({ ttfb_ms: 100, download_ms: 20, total_ms: 200 })).toEqual([
      { label: "TTFB", ms: 100 },
      { label: "Download", ms: 20 },
      { label: "Other", ms: 80 },
    ]);
  });

  it("returns no phases when nothing was measured", () => {
    expect(timingPhases({ ttfb_ms: null, download_ms: null, total_ms: null })).toEqual([]);
  });

  it("falls back to total when phases are missing", () => {
    expect(timingPhases({ ttfb_ms: null, download_ms: null, total_ms: 90 })).toEqual([{ label: "Other", ms: 90 }]);
  });
});
