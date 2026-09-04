import { describe, expect, it } from "vitest";
import { togglePinned } from "./pins";

describe("togglePinned", () => {
  it("adds an unpinned id", () => {
    expect(togglePinned(new Set(), 3)).toEqual(new Set([3]));
  });

  it("removes a pinned id", () => {
    expect(togglePinned(new Set([3]), 3)).toEqual(new Set());
  });

  it("leaves other ids untouched", () => {
    expect(togglePinned(new Set([1, 3]), 3)).toEqual(new Set([1]));
  });
});
