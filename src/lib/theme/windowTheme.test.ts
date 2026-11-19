import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type UiConfig } from "./config-types";

const mocks = vi.hoisted(() => ({
  tauri: false,
  setTheme: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("../tauri", () => ({
  get isTauri() {
    return mocks.tauri;
  },
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTheme: mocks.setTheme,
  }),
}));

import {
  createWindowAppearanceSync,
  nativeBlurFor,
  nativeThemeFor,
  syncWindowAppearance,
} from "./windowTheme";

function withWindow(
  window: Partial<NonNullable<UiConfig["window"]>>,
  config: Partial<UiConfig> = {},
): UiConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    window: { sidebar_opacity: 100, main_pane_glass: false, blur_radius: 24, ...window },
  };
}

beforeEach(() => {
  mocks.tauri = false;
  mocks.setTheme.mockReset();
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
});

describe("nativeThemeFor", () => {
  it("classifies concrete themes", () => {
    expect(nativeThemeFor("paper")).toBe("light");
    expect(nativeThemeFor("obsidian")).toBe("dark");
    expect(nativeThemeFor("contrast")).toBe("dark");
    expect(nativeThemeFor("carbon")).toBe("dark");
  });

  it("lets the os decide in system mode", () => {
    expect(nativeThemeFor("system")).toBeNull();
  });

  it("falls back to light for unknown modes", () => {
    expect(nativeThemeFor("bogus")).toBe("light");
  });
});

describe("nativeBlurFor", () => {
  it("sends zero when the window is solid", () => {
    expect(nativeBlurFor(withWindow({ sidebar_opacity: 100, blur_radius: 40 }))).toBe(0);
  });

  it("sends the configured radius when translucent", () => {
    expect(nativeBlurFor(withWindow({ sidebar_opacity: 72, blur_radius: 40 }))).toBe(40);
  });

  it("clamps the radius to the window server ceiling", () => {
    expect(nativeBlurFor(withWindow({ sidebar_opacity: 72, blur_radius: 99 }))).toBe(64);
  });

  it("defaults the radius when the window section is missing", () => {
    expect(nativeBlurFor(DEFAULT_CONFIG)).toBe(0);
    expect(nativeBlurFor(withWindow({ sidebar_opacity: 90 })).valueOf()).toBe(
      withWindow({ sidebar_opacity: 90 }).window?.blur_radius,
    );
  });
});

describe("createWindowAppearanceSync", () => {
  it("does nothing outside tauri", async () => {
    const sync = createWindowAppearanceSync();
    await sync(withWindow({ sidebar_opacity: 60 }));
    expect(mocks.setTheme).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("sends the theme and blur on the first apply", async () => {
    mocks.tauri = true;
    const sync = createWindowAppearanceSync();
    await sync(withWindow({ sidebar_opacity: 80, blur_radius: 30 }, { theme: "obsidian" }));
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(mocks.invoke).toHaveBeenCalledWith("set_window_blur", { radius: 30 });
  });

  it("skips values that did not change", async () => {
    mocks.tauri = true;
    const sync = createWindowAppearanceSync();
    await sync(withWindow({ sidebar_opacity: 80, blur_radius: 30 }));
    await sync(withWindow({ sidebar_opacity: 80, blur_radius: 30 }));
    expect(mocks.setTheme).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("resends the theme alone when only the theme changes", async () => {
    mocks.tauri = true;
    const sync = createWindowAppearanceSync();
    await sync(withWindow({ sidebar_opacity: 80 }, { theme: "paper" }));
    await sync(withWindow({ sidebar_opacity: 80 }, { theme: "carbon" }));
    expect(mocks.setTheme).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("resends the blur when the radius changes", async () => {
    mocks.tauri = true;
    const sync = createWindowAppearanceSync();
    await sync(withWindow({ sidebar_opacity: 80, blur_radius: 30 }));
    await sync(withWindow({ sidebar_opacity: 80, blur_radius: 48 }));
    expect(mocks.invoke).toHaveBeenCalledWith("set_window_blur", { radius: 48 });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("sends zero when the window goes solid", async () => {
    mocks.tauri = true;
    const sync = createWindowAppearanceSync();
    await sync(withWindow({ sidebar_opacity: 80, blur_radius: 30 }));
    await sync(withWindow({ sidebar_opacity: 100, blur_radius: 30 }));
    expect(mocks.invoke).toHaveBeenLastCalledWith("set_window_blur", { radius: 0 });
  });

  it("retries the blur after a failed send", async () => {
    mocks.tauri = true;
    mocks.invoke.mockRejectedValueOnce(new Error("window server refused"));
    const sync = createWindowAppearanceSync();
    await sync(withWindow({ sidebar_opacity: 80, blur_radius: 30 }));
    await sync(withWindow({ sidebar_opacity: 80, blur_radius: 30 }));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("retries the theme after a failed send", async () => {
    mocks.tauri = true;
    mocks.setTheme.mockRejectedValueOnce(new Error("no window"));
    const sync = createWindowAppearanceSync();
    await sync(withWindow({ sidebar_opacity: 80 }, { theme: "paper" }));
    await sync(withWindow({ sidebar_opacity: 80 }, { theme: "paper" }));
    expect(mocks.setTheme).toHaveBeenCalledTimes(2);
  });

  it("keeps independent dedupe state per instance", async () => {
    mocks.tauri = true;
    const first = createWindowAppearanceSync();
    const second = createWindowAppearanceSync();
    await first(withWindow({ sidebar_opacity: 80, blur_radius: 30 }));
    await second(withWindow({ sidebar_opacity: 80, blur_radius: 30 }));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});

describe("syncWindowAppearance", () => {
  it("resolves without side effects outside tauri", async () => {
    await expect(syncWindowAppearance(DEFAULT_CONFIG)).resolves.toBeUndefined();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
