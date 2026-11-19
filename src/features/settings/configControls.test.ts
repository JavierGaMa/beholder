import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type UiConfig } from "../../lib/theme/config-types";
import {
  withConsolePatch,
  withCustomAccent,
  withNamedAccent,
  withTheme,
} from "./configControls";

const base: UiConfig = {
  ...DEFAULT_CONFIG,
  console: { ring_lines: 10000, show_tid: false, default_buffer: "main" },
};

describe("withTheme", () => {
  it("changes the theme and preserves every other field", () => {
    const next = withTheme(base, "obsidian");
    expect(next.theme).toBe("obsidian");
    expect(next.accent).toBe(base.accent);
    expect(next.console).toEqual(base.console);
    expect(next.colors).toEqual(base.colors);
  });

  it("does not mutate the input config", () => {
    const next = withTheme(base, "carbon");
    expect(next).not.toBe(base);
    expect(base.theme).toBe("paper");
  });
});

describe("accent mutations", () => {
  it("clears a custom color override when a named accent is chosen", () => {
    const custom = withCustomAccent(base, "#ff00ff");
    expect(custom.colors?.accent).toBe("#ff00ff");
    const named = withNamedAccent(custom, "cyan");
    expect(named.accent).toBe("cyan");
    expect(named.colors?.accent).toBeNull();
  });

  it("keeps unrelated color overrides intact through both mutations", () => {
    const tinted: UiConfig = {
      ...base,
      colors: { bg: "#000000", accent: "#ff00ff" },
    };
    expect(withNamedAccent(tinted, "lime").colors?.bg).toBe("#000000");
    expect(withCustomAccent(tinted, "#00ff00").colors?.bg).toBe("#000000");
  });

  it("preserves the console section through accent changes", () => {
    const next = withCustomAccent(base, "#00ff00");
    expect(next.console).toEqual(base.console);
  });
});

describe("withConsolePatch", () => {
  it("merges a partial console patch and keeps the rest of the section", () => {
    const next = withConsolePatch(base, { show_tid: true });
    expect(next.console?.show_tid).toBe(true);
    expect(next.console?.ring_lines).toBe(10000);
    expect(next.console?.default_buffer).toBe("main");
  });

  it("round-trips several patches without losing earlier ones", () => {
    let config = base;
    config = withConsolePatch(config, { ring_lines: 5000 });
    config = withConsolePatch(config, { default_buffer: "system" });
    config = withConsolePatch(config, { show_tid: true });
    expect(config.console).toEqual({
      ring_lines: 5000,
      show_tid: true,
      default_buffer: "system",
    });
  });

  it("defaults the console section when the config carries none", () => {
    const bare: UiConfig = { ...base, console: undefined };
    const next = withConsolePatch(bare, { ring_lines: 2000 });
    expect(next.console?.ring_lines).toBe(2000);
    expect(next.console?.show_tid).toBe(false);
  });

  it("leaves appearance fields untouched", () => {
    const next = withConsolePatch(base, { ring_lines: 1 });
    expect(next.theme).toBe(base.theme);
    expect(next.accent).toBe(base.accent);
    expect(next.colors).toEqual(base.colors);
  });
});
