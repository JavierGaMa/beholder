import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ tauri: false, setTheme: vi.fn() }));

vi.mock("../tauri", () => ({
  get isTauri() {
    return mocks.tauri;
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTheme: mocks.setTheme,
  }),
}));

import { syncWindowTheme } from "./windowTheme";

beforeEach(() => {
  mocks.tauri = false;
  mocks.setTheme.mockClear();
});

describe("syncWindowTheme", () => {
  it("does nothing outside tauri", async () => {
    await syncWindowTheme("obsidian");
    expect(mocks.setTheme).not.toHaveBeenCalled();
  });

  it("syncs the title bar to the theme classification", async () => {
    mocks.tauri = true;
    await syncWindowTheme("paper");
    expect(mocks.setTheme).toHaveBeenCalledWith("light");
    await syncWindowTheme("obsidian");
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    await syncWindowTheme("contrast");
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
  });

  it("lets the os decide in system mode", async () => {
    mocks.tauri = true;
    await syncWindowTheme("system");
    expect(mocks.setTheme).toHaveBeenCalledWith(null);
  });

  it("falls back to light for unknown modes", async () => {
    mocks.tauri = true;
    await syncWindowTheme("bogus");
    expect(mocks.setTheme).toHaveBeenCalledWith("light");
  });

  it("swallows window api failures", async () => {
    mocks.tauri = true;
    mocks.setTheme.mockRejectedValueOnce(new Error("no window"));
    await expect(syncWindowTheme("carbon")).resolves.toBeUndefined();
  });
});
