import type { UiConfig } from "./config-types";

const TOKEN_MAP: Record<string, string> = {
  bg: "--bg",
  surface: "--surface",
  surface_2: "--surface-2",
  line: "--line",
  text: "--txt",
  muted: "--muted",
  accent: "--accent",
  ok: "--ok",
  warn: "--warn",
  danger: "--danger",
};

export function applyUiConfig(config: UiConfig) {
  const root = document.documentElement;
  applyThemeVars(config.theme, config.accent);

  root.style.setProperty("--ui-size", `${config.ui_font_size}px`);
  root.style.setProperty("--mono-size", `${config.mono_font_size}px`);
  root.style.setProperty("--row-h", `${config.row_height}px`);

  if (config.mono_font_family && config.mono_font_family.trim()) {
    root.style.setProperty(
      "--font-mono",
      `"${config.mono_font_family.trim()}", "JetBrains Mono", "SF Mono", ui-monospace, monospace`,
    );
  } else {
    root.style.removeProperty("--font-mono");
  }

  for (const [key, cssVar] of Object.entries(TOKEN_MAP)) {
    const value = (config.colors as Record<string, string | undefined>)[key];
    if (value && value.trim()) {
      root.style.setProperty(cssVar, value.trim());
    } else {
      root.style.removeProperty(cssVar);
    }
  }
}

function applyThemeVars(theme: string, accent: string) {
  root.dataset.theme = theme;
  root.dataset.accent = accent;
}

const root = document.documentElement;
