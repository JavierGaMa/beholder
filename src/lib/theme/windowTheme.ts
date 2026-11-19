import { isTauri } from "../tauri";
import { resolveThemeName, THEME_SCHEMES } from "./themes";

export async function syncWindowTheme(mode: string): Promise<void> {
  if (!isTauri) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (mode === "system") {
      await win.setTheme(null);
      return;
    }
    await win.setTheme(THEME_SCHEMES[resolveThemeName(mode, null)]);
  } catch {
    return;
  }
}
