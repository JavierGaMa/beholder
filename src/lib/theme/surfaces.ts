import type { UiConfig } from "./config-types";
import { prefersDarkScheme, resolveThemeName, THEME_WINDOW_VALUES } from "./themes";

export const SIDEBAR_OPACITY_MAX = 100;
export const BLUR_RADIUS_MAX = 64;

export const GLASS_TOKENS = ["--surface", "--surface-2", "--line", "--bg"] as const;

const RAISED_SHARE = 0.6;
const HAIRLINE_PERCENT = 8;

export interface ResolvedWindowValues {
  sidebar_opacity: number;
  main_pane_glass: boolean;
  blur_radius: number;
}

export function resolveWindowValues(config: UiConfig): ResolvedWindowValues {
  const curated = THEME_WINDOW_VALUES[resolveThemeName(config.theme, currentSchemePrefersDark())];
  const overrides = config.window;
  return {
    sidebar_opacity: clamp(
      Math.round(overrides?.sidebar_opacity ?? curated.sidebar_opacity),
      0,
      SIDEBAR_OPACITY_MAX,
    ),
    main_pane_glass: overrides?.main_pane_glass ?? curated.main_pane_glass,
    blur_radius: clamp(Math.round(overrides?.blur_radius ?? curated.blur_radius), 0, BLUR_RADIUS_MAX),
  };
}

export function windowOpacity(config: UiConfig): number {
  return resolveWindowValues(config).sidebar_opacity;
}

export function blurRadius(config: UiConfig): number {
  return resolveWindowValues(config).blur_radius;
}

export function isWindowTranslucent(config: UiConfig): boolean {
  return windowOpacity(config) < SIDEBAR_OPACITY_MAX;
}

export function surfaceTokens(config: UiConfig): Record<string, string> {
  const resolved = resolveWindowValues(config);
  if (resolved.sidebar_opacity >= SIDEBAR_OPACITY_MAX) return {};
  const percent = resolved.sidebar_opacity;
  const raised = Math.round(percent + (SIDEBAR_OPACITY_MAX - percent) * RAISED_SHARE);
  const tokens: Record<string, string> = {
    "--surface": glass("--surface-solid", percent),
    "--line": glass("--txt-solid", HAIRLINE_PERCENT),
  };
  if (resolved.main_pane_glass) {
    tokens["--bg"] = glass("--bg-solid", percent);
    tokens["--surface-2"] = glass("--surface-2-solid", raised);
  }
  return tokens;
}

function currentSchemePrefersDark(): boolean | null {
  return typeof window === "undefined" ? null : prefersDarkScheme(window);
}

function glass(token: string, percent: number): string {
  return `color-mix(in oklab, var(${token}) ${percent}%, transparent)`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
