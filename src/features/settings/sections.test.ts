import { describe, expect, it } from "vitest";
import {
  SETTINGS_SECTIONS,
  lastActiveSection,
  nextSectionId,
  rememberActiveSection,
  type SettingsSectionId,
} from "./sections";

describe("settings section model", () => {
  it("defines the five sections in nav order", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      "appearance",
      "agent-bridge",
      "console",
      "devices",
      "about",
    ]);
  });

  it("gives every section a non-empty label", () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it("has unique section ids", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("nextSectionId", () => {
  it("moves down and up through the list", () => {
    expect(nextSectionId("appearance", "ArrowDown")).toBe("agent-bridge");
    expect(nextSectionId("console", "ArrowDown")).toBe("devices");
    expect(nextSectionId("devices", "ArrowUp")).toBe("console");
  });

  it("wraps in both directions", () => {
    expect(nextSectionId("about", "ArrowDown")).toBe("appearance");
    expect(nextSectionId("appearance", "ArrowUp")).toBe("about");
  });

  it("supports horizontal arrows for the vertical tablist", () => {
    expect(nextSectionId("appearance", "ArrowRight")).toBe("agent-bridge");
    expect(nextSectionId("agent-bridge", "ArrowLeft")).toBe("appearance");
  });

  it("jumps to the ends with Home and End", () => {
    expect(nextSectionId("console", "Home")).toBe("appearance");
    expect(nextSectionId("console", "End")).toBe("about");
  });

  it("returns the current section for unrelated keys", () => {
    expect(nextSectionId("devices", "Enter")).toBe("devices");
    expect(nextSectionId("devices", "a")).toBe("devices");
  });
});

describe("active section persistence", () => {
  it("returns null before any section is remembered", () => {
    expect(lastActiveSection()).toBeNull();
  });

  it("remembers the last active section in session state", () => {
    rememberActiveSection("console" as SettingsSectionId);
    expect(lastActiveSection()).toBe("console");
    rememberActiveSection("about" as SettingsSectionId);
    expect(lastActiveSection()).toBe("about");
  });
});
