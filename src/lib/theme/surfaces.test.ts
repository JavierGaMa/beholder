import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type UiConfig } from "./config-types";
import {
  blurRadius,
  isWindowTranslucent,
  resolveWindowValues,
  SIDEBAR_OPACITY_MAX,
  surfaceTokens,
  windowOpacity,
} from "./surfaces";

vi.mock("../tauri", () => ({
  get isTauri() {
    return false;
  },
}));

function withWindow(
  overrides: Partial<NonNullable<UiConfig["window"]>> = {},
  config: Partial<UiConfig> = {},
): UiConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    window: { sidebar_opacity: null, main_pane_glass: null, blur_radius: null, ...overrides },
  };
}

function glass(token: string, percent: number): string {
  return `color-mix(in oklab, var(${token}) ${percent}%, transparent)`;
}

function stubScheme(prefersDark: boolean) {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: prefersDark }) });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveWindowValues", () => {
  it("follows the curated values of the active theme", () => {
    expect(resolveWindowValues(withWindow({}, { theme: "paper" }))).toEqual({
      sidebar_opacity: 100,
      main_pane_glass: false,
      blur_radius: 0,
    });
    expect(resolveWindowValues(withWindow({}, { theme: "eclipse" }))).toEqual({
      sidebar_opacity: 84,
      main_pane_glass: false,
      blur_radius: 32,
    });
  });

  it("resolves system mode against the os scheme", () => {
    stubScheme(true);
    expect(resolveWindowValues(withWindow({}, { theme: "system" }))).toEqual({
      sidebar_opacity: 86,
      main_pane_glass: false,
      blur_radius: 30,
    });
    stubScheme(false);
    expect(resolveWindowValues(withWindow({}, { theme: "system" }))).toEqual({
      sidebar_opacity: 100,
      main_pane_glass: false,
      blur_radius: 0,
    });
  });

  it("applies each override field independently over the curated values", () => {
    expect(
      resolveWindowValues(withWindow({ sidebar_opacity: 40 }, { theme: "obsidian" })),
    ).toEqual({ sidebar_opacity: 40, main_pane_glass: false, blur_radius: 30 });
    expect(
      resolveWindowValues(withWindow({ blur_radius: 12 }, { theme: "obsidian" })),
    ).toEqual({ sidebar_opacity: 86, main_pane_glass: false, blur_radius: 12 });
    expect(
      resolveWindowValues(withWindow({ main_pane_glass: true }, { theme: "obsidian" })),
    ).toEqual({ sidebar_opacity: 86, main_pane_glass: true, blur_radius: 30 });
  });

  it("treats explicit null overrides as absent", () => {
    expect(
      resolveWindowValues(
        withWindow({ sidebar_opacity: null, main_pane_glass: null, blur_radius: null }, { theme: "carbon" }),
      ),
    ).toEqual({ sidebar_opacity: 90, main_pane_glass: false, blur_radius: 24 });
  });

  it("clamps and rounds overrides", () => {
    expect(resolveWindowValues(withWindow({ sidebar_opacity: 140 }, { theme: "paper" })).sidebar_opacity).toBe(100);
    expect(resolveWindowValues(withWindow({ sidebar_opacity: -5 }, { theme: "paper" })).sidebar_opacity).toBe(0);
    expect(resolveWindowValues(withWindow({ sidebar_opacity: 72.4 }, { theme: "paper" })).sidebar_opacity).toBe(72);
    expect(resolveWindowValues(withWindow({ blur_radius: 99 }, { theme: "paper" })).blur_radius).toBe(64);
    expect(resolveWindowValues(withWindow({ blur_radius: -3 }, { theme: "paper" })).blur_radius).toBe(0);
  });

  it("treats a missing window section as theme-following", () => {
    expect(resolveWindowValues({ ...DEFAULT_CONFIG, theme: "carbon", window: undefined })).toEqual({
      sidebar_opacity: 90,
      main_pane_glass: false,
      blur_radius: 24,
    });
  });
});

describe("isWindowTranslucent", () => {
  it("is solid for the curated solid themes", () => {
    expect(isWindowTranslucent(withWindow({}, { theme: "paper" }))).toBe(false);
    expect(isWindowTranslucent(withWindow({}, { theme: "contrast" }))).toBe(false);
  });

  it("is translucent for the curated glass themes", () => {
    expect(isWindowTranslucent(withWindow({}, { theme: "obsidian" }))).toBe(true);
    expect(isWindowTranslucent(withWindow({}, { theme: "carbon" }))).toBe(true);
    expect(isWindowTranslucent(withWindow({}, { theme: "eclipse" }))).toBe(true);
  });

  it("follows an explicit opacity override in either direction", () => {
    expect(isWindowTranslucent(withWindow({ sidebar_opacity: 99 }, { theme: "paper" }))).toBe(true);
    expect(isWindowTranslucent(withWindow({ sidebar_opacity: 100 }, { theme: "obsidian" }))).toBe(false);
  });
});

describe("windowOpacity", () => {
  it("returns the resolved opacity", () => {
    expect(windowOpacity(withWindow({}, { theme: "eclipse" }))).toBe(84);
    expect(windowOpacity(withWindow({ sidebar_opacity: 72 }, { theme: "eclipse" }))).toBe(72);
  });

  it("clamps above the maximum and below zero", () => {
    expect(windowOpacity(withWindow({ sidebar_opacity: 140 }, { theme: "paper" }))).toBe(SIDEBAR_OPACITY_MAX);
    expect(windowOpacity(withWindow({ sidebar_opacity: -5 }, { theme: "paper" }))).toBe(0);
  });
});

describe("blurRadius", () => {
  it("returns the curated radius when unset", () => {
    expect(blurRadius(withWindow({}, { theme: "obsidian" }))).toBe(30);
    expect(blurRadius(withWindow({}, { theme: "paper" }))).toBe(0);
  });

  it("returns the override when set and clamps to the window server ceiling", () => {
    expect(blurRadius(withWindow({ blur_radius: 40 }, { theme: "obsidian" }))).toBe(40);
    expect(blurRadius(withWindow({ blur_radius: 99 }, { theme: "obsidian" }))).toBe(64);
    expect(blurRadius(withWindow({ blur_radius: -3 }, { theme: "obsidian" }))).toBe(0);
  });
});

describe("surfaceTokens", () => {
  it("writes nothing for the curated solid themes", () => {
    expect(surfaceTokens(withWindow({}, { theme: "paper" }))).toEqual({});
    expect(surfaceTokens(withWindow({}, { theme: "contrast" }))).toEqual({});
  });

  it("writes nothing at full opacity even with main pane glass", () => {
    expect(
      surfaceTokens(withWindow({ sidebar_opacity: 100, main_pane_glass: true }, { theme: "obsidian" })),
    ).toEqual({});
  });

  it("glazes the surface at the curated opacity of the theme", () => {
    const tokens = surfaceTokens(withWindow({}, { theme: "obsidian" }));
    expect(tokens["--surface"]).toBe(glass("--surface-solid", 86));
    expect(tokens["--line"]).toBe(glass("--txt-solid", 8));
  });

  it("glazes the surface at an override opacity", () => {
    const tokens = surfaceTokens(withWindow({ sidebar_opacity: 70 }, { theme: "paper" }));
    expect(tokens["--surface"]).toBe(glass("--surface-solid", 70));
  });

  it("leaves the background opaque without main pane glass", () => {
    const tokens = surfaceTokens(withWindow({ sidebar_opacity: 60 }, { theme: "paper" }));
    expect(tokens["--bg"]).toBeUndefined();
    expect(tokens["--surface-2"]).toBeUndefined();
  });

  it("glazes the background and raises surface-2 with main pane glass", () => {
    const tokens = surfaceTokens(withWindow({ sidebar_opacity: 50, main_pane_glass: true }, { theme: "paper" }));
    expect(tokens["--bg"]).toBe(glass("--bg-solid", 50));
    expect(tokens["--surface-2"]).toBe(glass("--surface-2-solid", 80));
  });

  it("uses the resolved main pane glass flag of the theme", () => {
    expect(surfaceTokens(withWindow({}, { theme: "eclipse" }))["--bg"]).toBeUndefined();
  });

  it("raises surface-2 sixty percent of the way back at every extreme", () => {
    const at = (opacity: number) =>
      surfaceTokens(withWindow({ sidebar_opacity: opacity, main_pane_glass: true }, { theme: "paper" }))["--surface-2"];
    expect(at(0)).toBe(glass("--surface-2-solid", 60));
    expect(at(99)).toBe(glass("--surface-2-solid", 100));
    expect(at(40)).toBe(glass("--surface-2-solid", 76));
  });

  it("glazes at zero percent when opacity is zero", () => {
    const tokens = surfaceTokens(withWindow({ sidebar_opacity: 0 }, { theme: "paper" }));
    expect(tokens["--surface"]).toBe(glass("--surface-solid", 0));
  });
});
