import { describe, expect, it } from "vitest";
import { bannerTitle, downloadPct, notesLine } from "./updaterFormat";

describe("downloadPct", () => {
  it("returns 0 when total is unknown or invalid", () => {
    expect(downloadPct(100, null)).toBe(0);
    expect(downloadPct(100, undefined)).toBe(0);
    expect(downloadPct(100, 0)).toBe(0);
    expect(downloadPct(100, -5)).toBe(0);
  });

  it("returns 0 before any bytes arrive", () => {
    expect(downloadPct(0, 1000)).toBe(0);
  });

  it("computes rounded percentage", () => {
    expect(downloadPct(1, 3)).toBe(33);
    expect(downloadPct(50, 100)).toBe(50);
  });

  it("caps at 100", () => {
    expect(downloadPct(120, 100)).toBe(100);
  });
});

describe("bannerTitle", () => {
  it("includes the product and version", () => {
    expect(bannerTitle("0.2.0")).toBe("Beholder 0.2.0 available");
  });
});

describe("notesLine", () => {
  it("returns null for empty notes", () => {
    expect(notesLine(null)).toBeNull();
    expect(notesLine(undefined)).toBeNull();
    expect(notesLine("   ")).toBeNull();
  });

  it("collapses whitespace into one line", () => {
    expect(notesLine("fixed\n\n  proxy   leak\n- ca rotation")).toBe(
      "fixed proxy leak - ca rotation",
    );
  });

  it("truncates long notes with an ellipsis", () => {
    const long = "a".repeat(300);
    const out = notesLine(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(120);
    expect(out!.endsWith("…")).toBe(true);
  });
});
