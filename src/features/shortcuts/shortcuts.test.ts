import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS, VIEW_SHORTCUTS } from "./shortcuts";

describe("shortcut catalog", () => {
  it("has at least one group and every group is labeled", () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
    for (const g of SHORTCUT_GROUPS) {
      expect(g.label.length).toBeGreaterThan(0);
    }
  });

  it("gives every entry non-empty keys and description", () => {
    for (const g of SHORTCUT_GROUPS) {
      expect(g.entries.length).toBeGreaterThan(0);
      for (const e of g.entries) {
        expect(e.keys.length).toBeGreaterThan(0);
        expect(e.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("opens the shortcut help itself with question mark", () => {
    const global = SHORTCUT_GROUPS[0]?.entries ?? [];
    expect(global.some((e) => e.keys.includes("?"))).toBe(true);
  });

  it("documents escape and the command palette", () => {
    const keys = SHORTCUT_GROUPS.flatMap((g) => g.entries.map((e) => e.keys));
    expect(keys).toContain("Esc");
    expect(keys).toContain("Cmd/Ctrl+K");
  });

  it("does not document a sidebar toggle", () => {
    const entries = SHORTCUT_GROUPS.flatMap((g) => g.entries);
    expect(entries.some((e) => e.keys === "Cmd/Ctrl+B")).toBe(false);
    expect(entries.some((e) => /sidebar/i.test(e.description))).toBe(false);
  });
});

describe("view shortcuts", () => {
  it("maps digits 1 through 8 to the eight views in rail order", () => {
    expect(VIEW_SHORTCUTS).toEqual([
      { digit: "1", view: "requests" },
      { digit: "2", view: "websockets" },
      { digit: "3", view: "metrics" },
      { digit: "4", view: "routes" },
      { digit: "5", view: "emulators" },
      { digit: "6", view: "apks" },
      { digit: "7", view: "database" },
      { digit: "8", view: "console" },
    ]);
  });

  it("matches the view shortcuts listed in the catalog", () => {
    const nav = SHORTCUT_GROUPS.find((g) => g.label === "Navigation");
    expect(nav).toBeDefined();
    for (const v of VIEW_SHORTCUTS) {
      expect(
        nav?.entries.some((e) => e.keys === `Cmd/Ctrl+${v.digit}`),
      ).toBe(true);
    }
  });
});
