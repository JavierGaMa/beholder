import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type UiConfig } from "./config-types";

const listeners = new Set<() => void>();
const media = {
  matches: false,
  addEventListener: (_type: string, listener: () => void) => {
    listeners.add(listener);
  },
  removeEventListener: (_type: string, listener: () => void) => {
    listeners.delete(listener);
  },
};

const dataset: Record<string, string> = {};
const style = {
  setProperty: vi.fn(),
  removeProperty: vi.fn(),
};
const bodyStyle = {
  setProperty: vi.fn(),
  removeProperty: vi.fn(),
};

vi.stubGlobal(
  "document",
  { documentElement: { dataset, style }, body: { style: bodyStyle } },
);
vi.stubGlobal("window", { matchMedia: () => media });

const { applyUiConfig } = await import("./applyConfig");

function baseConfig(overrides: Partial<UiConfig> = {}): UiConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function fireSchemeChange() {
  for (const listener of [...listeners]) listener();
}

describe("applyUiConfig", () => {
  it("resolves the system mode to a concrete theme at apply time", () => {
    media.matches = false;
    applyUiConfig(baseConfig({ theme: "system" }));
    expect(dataset.theme).toBe("paper");
    expect(dataset.accent).toBe("lime");
    expect(listeners.size).toBe(1);
  });

  it("re-applies with the new scheme while system mode stays active", () => {
    media.matches = true;
    fireSchemeChange();
    expect(dataset.theme).toBe("obsidian");
    expect(listeners.size).toBe(1);
  });

  it("stops following the os scheme once a concrete theme is applied", () => {
    applyUiConfig(baseConfig({ theme: "carbon" }));
    expect(dataset.theme).toBe("carbon");
    expect(listeners.size).toBe(0);
    media.matches = false;
    expect(dataset.theme).toBe("carbon");
  });

  it("does not subscribe for concrete themes on first apply", () => {
    applyUiConfig(baseConfig({ theme: "paper" }));
    expect(listeners.size).toBe(0);
  });

  it("applies the accent name and metric tokens", () => {
    applyUiConfig(baseConfig({ accent: "cyan", row_height: 40 }));
    expect(dataset.accent).toBe("cyan");
    expect(style.setProperty).toHaveBeenCalledWith("--row-h", "40px");
  });

  it("applies color overrides and removes them when absent", () => {
    applyUiConfig(baseConfig({ colors: { accent: "#112233" } }));
    expect(style.setProperty).toHaveBeenCalledWith("--accent", "#112233");
    applyUiConfig(baseConfig());
    expect(style.removeProperty).toHaveBeenCalledWith("--accent");
  });

  it("sets and clears the mono font override", () => {
    applyUiConfig(baseConfig({ mono_font_family: " Fira Code " }));
    expect(style.setProperty).toHaveBeenCalledWith(
      "--font-mono",
      expect.stringContaining("Fira Code"),
    );
    applyUiConfig(baseConfig({ mono_font_family: "" }));
    expect(style.removeProperty).toHaveBeenCalledWith("--font-mono");
  });

  it("marks the window solid and writes no glass tokens at full opacity", () => {
    bodyStyle.setProperty.mockClear();
    applyUiConfig(baseConfig());
    expect(dataset.surface).toBe("solid");
    expect(bodyStyle.setProperty).not.toHaveBeenCalled();
  });

  it("writes glass tokens and marks the window translucent", () => {
    applyUiConfig(
      baseConfig({ window: { sidebar_opacity: 70, main_pane_glass: false, blur_radius: 30 } }),
    );
    expect(dataset.surface).toBe("translucent");
    expect(bodyStyle.setProperty).toHaveBeenCalledWith(
      "--surface",
      "color-mix(in oklab, var(--surface-solid) 70%, transparent)",
    );
    expect(bodyStyle.setProperty).toHaveBeenCalledWith(
      "--line",
      "color-mix(in oklab, var(--txt-solid) 8%, transparent)",
    );
    expect(bodyStyle.setProperty).not.toHaveBeenCalledWith("--bg", expect.anything());
    expect(bodyStyle.setProperty).not.toHaveBeenCalledWith("--surface-2", expect.anything());
  });

  it("glazes the background and raises surface-2 with main pane glass", () => {
    applyUiConfig(
      baseConfig({ window: { sidebar_opacity: 50, main_pane_glass: true, blur_radius: 30 } }),
    );
    expect(bodyStyle.setProperty).toHaveBeenCalledWith(
      "--bg",
      "color-mix(in oklab, var(--bg-solid) 50%, transparent)",
    );
    expect(bodyStyle.setProperty).toHaveBeenCalledWith(
      "--surface-2",
      "color-mix(in oklab, var(--surface-2-solid) 80%, transparent)",
    );
  });

  it("clears glass tokens when the window returns to solid", () => {
    applyUiConfig(
      baseConfig({ window: { sidebar_opacity: 60, main_pane_glass: true, blur_radius: 30 } }),
    );
    bodyStyle.removeProperty.mockClear();
    applyUiConfig(baseConfig());
    expect(dataset.surface).toBe("solid");
    expect(bodyStyle.removeProperty).toHaveBeenCalledWith("--surface");
    expect(bodyStyle.removeProperty).toHaveBeenCalledWith("--surface-2");
    expect(bodyStyle.removeProperty).toHaveBeenCalledWith("--line");
    expect(bodyStyle.removeProperty).toHaveBeenCalledWith("--bg");
  });
});
