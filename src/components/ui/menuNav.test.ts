import { describe, expect, it } from "vitest";
import { nextMenuIndex } from "./menuNav";

const enabled = [true, true, true];
const withDisabled = [true, false, true, false, true];

describe("nextMenuIndex", () => {
  it("selects the first enabled item on ArrowDown from nothing focused", () => {
    expect(nextMenuIndex("ArrowDown", -1, enabled)).toBe(0);
  });

  it("selects the last enabled item on ArrowUp from nothing focused", () => {
    expect(nextMenuIndex("ArrowUp", -1, enabled)).toBe(2);
  });

  it("moves down and up one step", () => {
    expect(nextMenuIndex("ArrowDown", 0, enabled)).toBe(1);
    expect(nextMenuIndex("ArrowUp", 1, enabled)).toBe(0);
  });

  it("wraps around both ends", () => {
    expect(nextMenuIndex("ArrowDown", 2, enabled)).toBe(0);
    expect(nextMenuIndex("ArrowUp", 0, enabled)).toBe(2);
  });

  it("skips disabled items moving down", () => {
    expect(nextMenuIndex("ArrowDown", 0, withDisabled)).toBe(2);
  });

  it("skips disabled items moving up", () => {
    expect(nextMenuIndex("ArrowUp", 2, withDisabled)).toBe(0);
  });

  it("jumps to first and last enabled item on Home and End", () => {
    expect(nextMenuIndex("Home", 3, withDisabled)).toBe(0);
    expect(nextMenuIndex("End", 1, withDisabled)).toBe(4);
  });

  it("returns the current index for unrelated keys", () => {
    expect(nextMenuIndex("Enter", 1, enabled)).toBe(1);
    expect(nextMenuIndex("a", -1, enabled)).toBe(-1);
  });

  it("keeps the current index when every item is disabled", () => {
    const allDisabled = [false, false];
    expect(nextMenuIndex("ArrowDown", -1, allDisabled)).toBe(-1);
    expect(nextMenuIndex("Home", 0, allDisabled)).toBe(0);
  });
});
