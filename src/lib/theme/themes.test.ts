import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTheme, THEMES, THEME_LABELS } from "./themes";

function stubStorage(entries: Record<string, string>) {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => entries[k] ?? null,
    setItem: vi.fn(),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadTheme", () => {
  it("defaults to the paper light theme when nothing is stored", () => {
    stubStorage({});
    expect(loadTheme()).toEqual({ theme: "paper", accent: "lime" });
  });

  it("keeps stored valid theme and accent", () => {
    stubStorage({ "beholder.theme": "obsidian", "beholder.accent": "cyan" });
    expect(loadTheme()).toEqual({ theme: "obsidian", accent: "cyan" });
  });

  it("falls back to defaults on stored values outside the known sets", () => {
    stubStorage({ "beholder.theme": "nope", "beholder.accent": "nope" });
    expect(loadTheme()).toEqual({ theme: "paper", accent: "lime" });
  });
});

describe("theme catalog", () => {
  it("lists paper first with one label per theme", () => {
    expect(THEMES[0]).toBe("paper");
    expect(Object.keys(THEME_LABELS)).toEqual([...THEMES]);
  });
});
