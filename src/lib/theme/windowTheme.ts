import { invoke, isTauri } from "../tauri";
import type { UiConfig } from "./config-types";
import { blurRadius, isWindowTranslucent } from "./surfaces";
import { resolveThemeName, THEME_SCHEMES } from "./themes";

export type NativeTheme = "dark" | "light" | null;

export function nativeThemeFor(mode: string): NativeTheme {
  if (mode === "system") return null;
  return THEME_SCHEMES[resolveThemeName(mode, null)];
}

export function nativeBlurFor(config: UiConfig): number {
  return isWindowTranslucent(config) ? blurRadius(config) : 0;
}

export function createWindowAppearanceSync() {
  let sentTheme: NativeTheme | undefined;
  let sentBlur: number | undefined;
  return async (config: UiConfig): Promise<void> => {
    if (!isTauri) return;
    let win;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      win = getCurrentWindow();
    } catch {
      return;
    }
    const nextTheme = nativeThemeFor(config.theme);
    const nextBlur = nativeBlurFor(config);
    if (nextTheme !== sentTheme) {
      try {
        await win.setTheme(nextTheme);
        sentTheme = nextTheme;
      } catch {
        sentTheme = undefined;
      }
    }
    if (nextBlur !== sentBlur) {
      try {
        await invoke("set_window_blur", { radius: nextBlur });
        sentBlur = nextBlur;
      } catch {
        sentBlur = undefined;
      }
    }
  };
}

const syncAppearance = createWindowAppearanceSync();

export function syncWindowAppearance(config: UiConfig): Promise<void> {
  return syncAppearance(config);
}
