export const THEMES = ["obsidian", "carbon", "eclipse"] as const;
export type ThemeName = (typeof THEMES)[number];

export const ACCENTS = ["cyan", "amber", "violet"] as const;
export type AccentName = (typeof ACCENTS)[number];

export const THEME_LABELS: Record<ThemeName, string> = {
  obsidian: "Obsidian",
  carbon: "Carbon",
  eclipse: "Eclipse",
};

export const ACCENT_SWATCHES: Record<AccentName, string> = {
  cyan: "#22d3ee",
  amber: "#fbbf24",
  violet: "#a78bfa",
};

export function applyTheme(theme: ThemeName, accent: AccentName) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.accent = accent;
  localStorage.setItem("beholder.theme", theme);
  localStorage.setItem("beholder.accent", accent);
}

export function loadTheme(): { theme: ThemeName; accent: AccentName } {
  const theme = localStorage.getItem("beholder.theme") as ThemeName | null;
  const accent = localStorage.getItem("beholder.accent") as AccentName | null;
  return {
    theme: theme && THEMES.includes(theme) ? theme : "obsidian",
    accent: accent && ACCENTS.includes(accent) ? accent : "cyan",
  };
}
