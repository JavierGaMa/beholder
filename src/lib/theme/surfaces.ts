import type { UiConfig } from "./config-types";

export const SIDEBAR_OPACITY_MAX = 100;
export const SIDEBAR_OPACITY_SLIDER_MIN = 40;
export const BLUR_RADIUS_MAX = 64;
export const DEFAULT_BLUR_RADIUS = 24;

export const GLASS_TOKENS = ["--surface", "--surface-2", "--line", "--bg"] as const;

const RAISED_SHARE = 0.6;
const HAIRLINE_PERCENT = 8;

export function windowOpacity(config: UiConfig): number {
  const raw = config.window?.sidebar_opacity ?? SIDEBAR_OPACITY_MAX;
  return clamp(Math.round(raw), 0, SIDEBAR_OPACITY_MAX);
}

export function blurRadius(config: UiConfig): number {
  const raw = config.window?.blur_radius ?? DEFAULT_BLUR_RADIUS;
  return clamp(Math.round(raw), 0, BLUR_RADIUS_MAX);
}

export function isWindowTranslucent(config: UiConfig): boolean {
  return windowOpacity(config) < SIDEBAR_OPACITY_MAX;
}

export function surfaceTokens(config: UiConfig): Record<string, string> {
  if (!isWindowTranslucent(config)) return {};
  const percent = windowOpacity(config);
  const raised = Math.round(percent + (SIDEBAR_OPACITY_MAX - percent) * RAISED_SHARE);
  const tokens: Record<string, string> = {
    "--surface": glass("--surface-solid", percent),
    "--line": glass("--txt-solid", HAIRLINE_PERCENT),
  };
  if (config.window?.main_pane_glass) {
    tokens["--bg"] = glass("--bg-solid", percent);
    tokens["--surface-2"] = glass("--surface-2-solid", raised);
  }
  return tokens;
}

function glass(token: string, percent: number): string {
  return `color-mix(in oklab, var(${token}) ${percent}%, transparent)`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
