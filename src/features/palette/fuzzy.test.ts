import { describe, expect, it } from "vitest";
import { fuzzyScore } from "./fuzzy";

function pair(a: ReturnType<typeof fuzzyScore>, b: ReturnType<typeof fuzzyScore>): [number, number] {
  if (a == null || b == null) throw new Error("expected both queries to match");
  return [a, b];
}

describe("fuzzyScore", () => {
  it("returns 0 for an empty query", () => {
    expect(fuzzyScore("", "Settings")).toBe(0);
    expect(fuzzyScore("", "")).toBe(0);
  });

  it("returns null when the target lacks a query character", () => {
    expect(fuzzyScore("zzz", "Settings")).toBeNull();
  });

  it("returns null when query characters appear out of order", () => {
    expect(fuzzyScore("gt", "settings")).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(fuzzyScore("SET", "Settings")).toBe(fuzzyScore("set", "settings"));
  });

  it("scores an exact match higher than a substring at an offset", () => {
    const [exact, offset] = pair(fuzzyScore("settings", "Settings"), fuzzyScore("settings", "Open settings"));
    expect(exact).toBeGreaterThan(offset);
  });

  it("ranks a prefix match above a later substring match", () => {
    const [prefix, suffix] = pair(fuzzyScore("req", "Requests"), fuzzyScore("req", "Clear requests"));
    expect(prefix).toBeGreaterThan(suffix);
  });

  it("matches scattered characters as a subsequence", () => {
    expect(fuzzyScore("stg", "Settings")).not.toBeNull();
  });

  it("ranks a substring match above a scattered match", () => {
    const [substring, scattered] = pair(fuzzyScore("clear", "Clear requests"), fuzzyScore("cls", "Clear requests"));
    expect(substring).toBeGreaterThan(scattered);
  });

  it("rewards consecutive characters over spread-out matches of equal length", () => {
    const [consecutive, spread] = pair(fuzzyScore("set", "settings"), fuzzyScore("stg", "settings"));
    expect(consecutive).toBeGreaterThan(spread);
  });

  it("keeps every substring match above every scattered match", () => {
    const [substring, scattered] = pair(fuzzyScore("x", "apks max"), fuzzyScore("aks", "apks"));
    expect(substring).toBeGreaterThan(scattered);
  });
});
