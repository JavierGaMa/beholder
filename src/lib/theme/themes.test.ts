import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "./config-types";

const mocks = vi.hoisted(() => ({ tauri: false }));

vi.mock("../tauri", () => ({
  get isTauri() {
    return mocks.tauri;
  },
}));

import {
  ACCENT_SWATCHES,
  applyTheme,
  customAccentSeed,
  loadTheme,
  resolveThemeName,
  SYSTEM_DARK_THEME,
  THEMES,
  THEME_LABELS,
  THEME_MODES,
  THEME_MODE_LABELS,
  THEME_SCHEMES,
  THEME_WINDOW_VALUES,
} from "./themes";

function stubStorage(entries: Record<string, string>) {
  const written: Record<string, string> = { ...entries };
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => written[k] ?? null,
    setItem: (k: string, v: string) => {
      written[k] = v;
    },
  });
  return written;
}

function stubDom(prefersDark: boolean) {
  const dataset: Record<string, string> = {};
  vi.stubGlobal("document", { documentElement: { dataset } });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: prefersDark }),
  });
  return dataset;
}

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.tauri = false;
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

  it("keeps the stored system mode", () => {
    stubStorage({ "beholder.theme": "system", "beholder.accent": "amber" });
    expect(loadTheme()).toEqual({ theme: "system", accent: "amber" });
  });
});

describe("theme catalog", () => {
  it("lists paper first with one label per theme", () => {
    expect(THEMES[0]).toBe("paper");
    expect(Object.keys(THEME_LABELS)).toEqual([...THEMES]);
  });
});

describe("resolveThemeName", () => {
  it("maps a light system preference to paper", () => {
    expect(resolveThemeName("system", false)).toBe("paper");
  });

  it("maps a dark system preference to the obsidian dark theme", () => {
    expect(SYSTEM_DARK_THEME).toBe("obsidian");
    expect(resolveThemeName("system", true)).toBe("obsidian");
  });

  it("falls back to paper when the system preference is unknown", () => {
    expect(resolveThemeName("system", null)).toBe("paper");
  });

  it("passes concrete theme names through regardless of scheme", () => {
    expect(resolveThemeName("carbon", true)).toBe("carbon");
    expect(resolveThemeName("eclipse", false)).toBe("eclipse");
  });

  it("falls back to paper for unknown modes", () => {
    expect(resolveThemeName("neon", true)).toBe("paper");
  });
});

describe("THEME_WINDOW_VALUES", () => {
  it("carries a curated window look for every theme", () => {
    expect(Object.keys(THEME_WINDOW_VALUES)).toEqual([...THEMES]);
    expect(THEME_WINDOW_VALUES.paper).toEqual({
      sidebar_opacity: 100,
      main_pane_glass: false,
      blur_radius: 0,
    });
    expect(THEME_WINDOW_VALUES.contrast).toEqual({
      sidebar_opacity: 100,
      main_pane_glass: false,
      blur_radius: 0,
    });
    expect(THEME_WINDOW_VALUES.obsidian).toEqual({
      sidebar_opacity: 86,
      main_pane_glass: false,
      blur_radius: 30,
    });
    expect(THEME_WINDOW_VALUES.carbon).toEqual({
      sidebar_opacity: 90,
      main_pane_glass: false,
      blur_radius: 24,
    });
    expect(THEME_WINDOW_VALUES.eclipse).toEqual({
      sidebar_opacity: 84,
      main_pane_glass: false,
      blur_radius: 32,
    });
  });

  it("keeps the light and high-contrast themes fully solid", () => {
    for (const theme of ["paper", "contrast"] as const) {
      expect(THEME_WINDOW_VALUES[theme].sidebar_opacity).toBe(100);
      expect(THEME_WINDOW_VALUES[theme].blur_radius).toBe(0);
      expect(THEME_WINDOW_VALUES[theme].main_pane_glass).toBe(false);
    }
  });
});

describe("system mode catalog", () => {
  it("appends system to the concrete themes without joining them", () => {
    expect(THEMES).not.toContain("system");
    expect([...THEME_MODES]).toEqual([...THEMES, "system"]);
  });

  it("labels every selectable mode including system", () => {
    expect(Object.keys(THEME_MODE_LABELS)).toEqual([...THEME_MODES]);
    expect(THEME_MODE_LABELS.system).toBe("System");
  });

  it("classifies every concrete theme as light or dark", () => {
    for (const theme of THEMES) {
      expect(["light", "dark"]).toContain(THEME_SCHEMES[theme]);
    }
    expect(THEME_SCHEMES.paper).toBe("light");
    expect(THEME_SCHEMES.contrast).toBe("dark");
    expect(THEME_SCHEMES.obsidian).toBe("dark");
    expect(THEME_SCHEMES.carbon).toBe("dark");
    expect(THEME_SCHEMES.eclipse).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("resolves the system mode against the os scheme at apply time", () => {
    const dataset = stubDom(true);
    const written = stubStorage({});
    applyTheme("system", "cyan");
    expect(dataset.theme).toBe("obsidian");
    expect(dataset.accent).toBe("cyan");
    expect(written["beholder.theme"]).toBe("system");
    expect(written["beholder.accent"]).toBe("cyan");
  });

  it("resolves the system mode to paper when the os prefers light", () => {
    const dataset = stubDom(false);
    stubStorage({});
    applyTheme("system", "lime");
    expect(dataset.theme).toBe("paper");
  });

  it("applies concrete themes unchanged", () => {
    const dataset = stubDom(true);
    const written = stubStorage({});
    applyTheme("contrast", "violet");
    expect(dataset.theme).toBe("contrast");
    expect(written["beholder.theme"]).toBe("contrast");
  });

  it("skips localStorage when running under tauri", () => {
    mocks.tauri = true;
    const dataset = stubDom(false);
    const written = stubStorage({});
    applyTheme("obsidian", "lime");
    expect(dataset.theme).toBe("obsidian");
    expect(written).toEqual({});
  });
});

describe("customAccentSeed", () => {
  it("seeds from a valid colors accent override lowercased", () => {
    const config = { ...DEFAULT_CONFIG, colors: { accent: "#FF00AA" } };
    expect(customAccentSeed(config)).toBe("#ff00aa");
  });

  it("falls back to the named accent swatch when the override is missing", () => {
    const config = { ...DEFAULT_CONFIG, accent: "cyan", colors: {} };
    expect(customAccentSeed(config)).toBe(ACCENT_SWATCHES.cyan);
  });

  it("falls back to the named accent swatch when the override is invalid", () => {
    const config = { ...DEFAULT_CONFIG, accent: "amber", colors: { accent: "nope" } };
    expect(customAccentSeed(config)).toBe(ACCENT_SWATCHES.amber);
  });

  it("falls back to lime when the named accent is unknown", () => {
    const config = { ...DEFAULT_CONFIG, accent: "scarlet", colors: {} };
    expect(customAccentSeed(config)).toBe(ACCENT_SWATCHES.lime);
  });
});
