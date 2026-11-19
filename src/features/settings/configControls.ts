import type { ConsoleConfig, UiConfig } from "../../lib/theme/config-types";

export function withTheme(config: UiConfig, theme: string): UiConfig {
  return { ...config, theme };
}

export function withNamedAccent(config: UiConfig, accent: string): UiConfig {
  return { ...config, accent, colors: { ...config.colors, accent: null } };
}

export function withCustomAccent(config: UiConfig, hex: string): UiConfig {
  return { ...config, colors: { ...config.colors, accent: hex } };
}

export const DEFAULT_CONSOLE_CONFIG: ConsoleConfig = {
  ring_lines: 10000,
  show_tid: false,
  default_buffer: "main",
};

export function withConsolePatch(config: UiConfig, patch: Partial<ConsoleConfig>): UiConfig {
  const current: ConsoleConfig = config.console ?? DEFAULT_CONSOLE_CONFIG;
  return { ...config, console: { ...current, ...patch } };
}

export async function resolveConfigPath(): Promise<string | null> {
  const hasTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as object);
  if (!hasTauri) return null;
  const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
  try {
    return await join(await appLocalDataDir(), "config.toml");
  } catch {
    return null;
  }
}

