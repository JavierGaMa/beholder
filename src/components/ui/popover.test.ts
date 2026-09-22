import { describe, expect, it } from "vitest";
import { computeDropdownStyle } from "./popover";

const MARGIN = 8;
const GAP = 8;

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, right: left + width, bottom: top + height, width, height } as DOMRect;
}

describe("computeDropdownStyle", () => {
  it("opens below and left-aligned when there is ample space", () => {
    const { style } = computeDropdownStyle(rect(100, 100, 120, 28), 1280, 800, {
      width: 384,
      estHeight: 360,
    });
    expect(style.position).toBe("fixed");
    expect(style.top).toBe(100 + 28 + GAP);
    expect(style.left).toBe(100);
    expect(style.width).toBe(384);
    expect(style.maxHeight).toBe(800 - MARGIN - (128 + GAP));
  });

  it("shifts left when the menu would overflow the right edge", () => {
    const { style } = computeDropdownStyle(rect(1000, 100, 120, 28), 1280, 800, {
      width: 384,
      estHeight: 360,
    });
    expect(style.left).toBe(1120 - 384);
    expect(Number(style.left) + 384).toBeLessThanOrEqual(1280 - MARGIN);
    expect(style.left).toBeGreaterThanOrEqual(MARGIN);
  });

  it("caps the right edge at the viewport margin when the anchor overflows", () => {
    const { style } = computeDropdownStyle(rect(1200, 100, 120, 28), 1280, 800, {
      width: 384,
      estHeight: 360,
    });
    expect(style.left).toBe(1280 - MARGIN - 384);
    expect(Number(style.left) + 384).toBeLessThanOrEqual(1280 - MARGIN);
  });

  it("flips above when there is more room above the anchor", () => {
    const { style } = computeDropdownStyle(rect(100, 672, 120, 28), 1280, 800, {
      width: 384,
      estHeight: 360,
    });
    expect(style.top).toBe(672 - GAP - 360);
    expect(style.maxHeight).toBe(360);
    expect(Number(style.top) + Number(style.maxHeight)).toBe(672 - GAP);
  });

  it("clamps a flipped menu to the top margin and shrinks its maxHeight", () => {
    const { style } = computeDropdownStyle(rect(100, 300, 120, 28), 1280, 500, {
      width: 384,
      estHeight: 360,
    });
    expect(style.top).toBe(MARGIN);
    expect(style.maxHeight).toBe(300 - GAP - MARGIN);
  });

  it("stays below with a clamped maxHeight when below has more room", () => {
    const { style } = computeDropdownStyle(rect(100, 60, 120, 28), 1280, 500, {
      width: 384,
      estHeight: 420,
    });
    expect(style.top).toBe(60 + 28 + GAP);
    expect(style.maxHeight).toBe(500 - MARGIN - (88 + GAP));
  });

  it("never produces negative coordinates on a tiny viewport", () => {
    const { style } = computeDropdownStyle(rect(10, 10, 120, 28), 300, 200, {
      width: 384,
      estHeight: 360,
    });
    expect(style.top).toBe(10 + 28 + GAP);
    expect(style.maxHeight).toBe(200 - MARGIN - (38 + GAP));
    expect(style.left).toBe(MARGIN);
    expect(Number(style.top)).toBeGreaterThanOrEqual(MARGIN);
    expect(Number(style.left)).toBeGreaterThanOrEqual(MARGIN);
    expect(Number(style.maxHeight)).toBeGreaterThanOrEqual(0);
  });

  it("respects the margin when the anchor sits at the left edge", () => {
    const { style } = computeDropdownStyle(rect(2, 100, 120, 28), 1280, 800, {
      width: 384,
      estHeight: 360,
    });
    expect(style.left).toBe(MARGIN);
    expect(style.top).toBe(100 + 28 + GAP);
  });

  it("honors a custom margin", () => {
    const { style } = computeDropdownStyle(rect(100, 100, 120, 28), 1280, 800, {
      width: 384,
      estHeight: 360,
      margin: 16,
    });
    expect(style.top).toBe(128 + GAP);
    expect(style.maxHeight).toBe(800 - 16 - 136);
  });
});
