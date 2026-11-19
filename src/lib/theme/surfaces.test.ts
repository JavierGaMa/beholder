import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type UiConfig } from "./config-types";
import {
  blurRadius,
  isWindowTranslucent,
  SIDEBAR_OPACITY_MAX,
  surfaceTokens,
  windowOpacity,
} from "./surfaces";

function withWindow(overrides: Partial<NonNullable<UiConfig["window"]>>): UiConfig {
  return {
    ...DEFAULT_CONFIG,
    window: { sidebar_opacity: 100, main_pane_glass: false, blur_radius: 24, ...overrides },
  };
}

function glass(token: string, percent: number): string {
  return `color-mix(in oklab, var(${token}) ${percent}%, transparent)`;
}

describe("isWindowTranslucent", () => {
  it("is solid at full opacity", () => {
    expect(isWindowTranslucent(withWindow({ sidebar_opacity: 100 }))).toBe(false);
  });

  it("is translucent below full opacity", () => {
    expect(isWindowTranslucent(withWindow({ sidebar_opacity: 99 }))).toBe(true);
  });

  it("treats a missing window section as solid", () => {
    expect(isWindowTranslucent(DEFAULT_CONFIG)).toBe(false);
  });
});

describe("windowOpacity", () => {
  it("returns the configured opacity", () => {
    expect(windowOpacity(withWindow({ sidebar_opacity: 72 }))).toBe(72);
  });

  it("clamps above the maximum", () => {
    expect(windowOpacity(withWindow({ sidebar_opacity: 140 }))).toBe(SIDEBAR_OPACITY_MAX);
  });

  it("clamps below zero and rounds fractional values", () => {
    expect(windowOpacity(withWindow({ sidebar_opacity: -5 }))).toBe(0);
    expect(windowOpacity(withWindow({ sidebar_opacity: 72.4 }))).toBe(72);
  });
});

describe("blurRadius", () => {
  it("defaults to 24 when unset", () => {
    expect(blurRadius(DEFAULT_CONFIG)).toBe(24);
  });

  it("returns the configured radius", () => {
    expect(blurRadius(withWindow({ blur_radius: 40 }))).toBe(40);
  });

  it("clamps to the window server ceiling", () => {
    expect(blurRadius(withWindow({ blur_radius: 99 }))).toBe(64);
    expect(blurRadius(withWindow({ blur_radius: -3 }))).toBe(0);
  });
});

describe("surfaceTokens", () => {
  it("writes nothing at full opacity", () => {
    expect(surfaceTokens(withWindow({ sidebar_opacity: 100 }))).toEqual({});
  });

  it("writes nothing at full opacity even with main pane glass", () => {
    expect(
      surfaceTokens(withWindow({ sidebar_opacity: 100, main_pane_glass: true })),
    ).toEqual({});
  });

  it("glazes the surface at the configured percent", () => {
    const tokens = surfaceTokens(withWindow({ sidebar_opacity: 70 }));
    expect(tokens["--surface"]).toBe(glass("--surface-solid", 70));
  });

  it("hairlines the line token with the foreground color", () => {
    const tokens = surfaceTokens(withWindow({ sidebar_opacity: 70 }));
    expect(tokens["--line"]).toBe(glass("--txt-solid", 8));
  });

  it("leaves the background opaque without main pane glass", () => {
    const tokens = surfaceTokens(withWindow({ sidebar_opacity: 60 }));
    expect(tokens["--bg"]).toBeUndefined();
    expect(tokens["--surface-2"]).toBeUndefined();
  });

  it("glazes the background and raises surface-2 with main pane glass", () => {
    const tokens = surfaceTokens(withWindow({ sidebar_opacity: 50, main_pane_glass: true }));
    expect(tokens["--bg"]).toBe(glass("--bg-solid", 50));
    expect(tokens["--surface-2"]).toBe(glass("--surface-2-solid", 80));
  });

  it("raises surface-2 sixty percent of the way back at every extreme", () => {
    expect(surfaceTokens(withWindow({ sidebar_opacity: 0, main_pane_glass: true }))["--surface-2"]).toBe(
      glass("--surface-2-solid", 60),
    );
    expect(surfaceTokens(withWindow({ sidebar_opacity: 99, main_pane_glass: true }))["--surface-2"]).toBe(
      glass("--surface-2-solid", 100),
    );
    expect(surfaceTokens(withWindow({ sidebar_opacity: 40, main_pane_glass: true }))["--surface-2"]).toBe(
      glass("--surface-2-solid", 76),
    );
  });

  it("glazes at zero percent when opacity is zero", () => {
    const tokens = surfaceTokens(withWindow({ sidebar_opacity: 0 }));
    expect(tokens["--surface"]).toBe(glass("--surface-solid", 0));
  });
});
