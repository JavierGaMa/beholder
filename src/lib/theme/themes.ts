import { isTauri } from "../tauri";
import type { UiConfig } from "./config-types";

export const THEMES = ["paper", "contrast", "obsidian", "carbon", "eclipse"] as const;
export type ThemeName = (typeof THEMES)[number];

export const SYSTEM_THEME_MODE = "system";
export type ThemeMode = ThemeName | "system";

export const THEME_MODES = [...THEMES, SYSTEM_THEME_MODE] as const;

export const ACCENTS = ["lime", "cyan", "amber", "violet"] as const;
export type AccentName = (typeof ACCENTS)[number];

export const THEME_LABELS: Record<ThemeName, string> = {
  paper: "Paper",
  contrast: "Contrast",
  obsidian: "Obsidian",
  carbon: "Carbon",
  eclipse: "Eclipse",
};

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  ...THEME_LABELS,
  system: "System",
};

export const THEME_SCHEMES: Record<ThemeName, "light" | "dark"> = {
  paper: "light",
  contrast: "dark",
  obsidian: "dark",
  carbon: "dark",
  eclipse: "dark",
};

export const SYSTEM_DARK_THEME: ThemeName = "obsidian";

export const ACCENT_SWATCHES: Record<AccentName, string> = {
  lime: "#c6fd00",
  cyan: "#22d3ee",
  amber: "#fbbf24",
  violet: "#a78bfa",
};

export function isThemeName(value: string): value is ThemeName {
  return (THEMES as readonly string[]).includes(value);
}

export function isThemeMode(value: string): value is ThemeMode {
  return value === SYSTEM_THEME_MODE || isThemeName(value);
}

export function isAccentName(value: string): value is AccentName {
  return (ACCENTS as readonly string[]).includes(value);
}

export function resolveThemeName(mode: string, prefersDark: boolean | null): ThemeName {
  if (mode === SYSTEM_THEME_MODE) {
    return prefersDark === true ? SYSTEM_DARK_THEME : "paper";
  }
  return isThemeName(mode) ? mode : "paper";
}

export function prefersDarkScheme(
  win: { matchMedia?: (query: string) => { matches: boolean } },
): boolean | null {
  if (typeof win.matchMedia !== "function") return null;
  return win.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(theme: ThemeMode, accent: AccentName) {
  const root = document.documentElement;
  root.dataset.theme = resolveThemeName(theme, prefersDarkScheme(window));
  root.dataset.accent = accent;
  if (isTauri) return;
  localStorage.setItem("beholder.theme", theme);
  localStorage.setItem("beholder.accent", accent);
}

export function persistThemeChoice(theme: string, accent: string) {
  localStorage.setItem("beholder.theme", theme);
  localStorage.setItem("beholder.accent", accent);
}

export function loadTheme(): { theme: ThemeMode; accent: AccentName } {
  const theme = localStorage.getItem("beholder.theme");
  const accent = localStorage.getItem("beholder.accent");
  return {
    theme: theme && isThemeMode(theme) ? theme : "paper",
    accent: accent && isAccentName(accent) ? accent : "lime",
  };
}

export function customAccentSeed(config: UiConfig): string {
  const custom = config.colors?.accent?.trim();
  if (custom && /^#[0-9a-fA-F]{6}$/.test(custom)) return custom.toLowerCase();
  return ACCENT_SWATCHES[isAccentName(config.accent) ? config.accent : "lime"];
}
