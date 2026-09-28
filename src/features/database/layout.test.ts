import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampDockHeight,
  clampPaneWidth,
  DBS_WIDTH_BOUNDS,
  DEFAULT_DB_LAYOUT,
  defaultDockHeight,
  DOCK_DEFAULT_RATIO,
  DOCK_MAX_RATIO,
  DOCK_MIN_HEIGHT,
  isRunShortcut,
  parseDbLayout,
  RAIL_WIDTH,
  resolvePaneWidth,
  serializeDbLayout,
  TABLES_WIDTH_BOUNDS,
} from "./layout";
import { loadDbLayout, saveDbLayout } from "../../lib/prefs";

function stubStorage(entries: Record<string, string> = {}) {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("layout constants", () => {
  it("pins the databases pane bounds and default", () => {
    expect(DBS_WIDTH_BOUNDS).toEqual({ min: 180, max: 420, fallback: 288 });
  });

  it("pins the tables pane bounds and default", () => {
    expect(TABLES_WIDTH_BOUNDS).toEqual({ min: 140, max: 320, fallback: 224 });
  });

  it("pins the rail width and dock height constants", () => {
    expect(RAIL_WIDTH).toBe(44);
    expect(DOCK_MIN_HEIGHT).toBe(120);
    expect(DOCK_MAX_RATIO).toBe(0.7);
    expect(DOCK_DEFAULT_RATIO).toBe(0.4);
  });
});

describe("clampPaneWidth", () => {
  it("returns the input when it is within bounds", () => {
    expect(clampPaneWidth(288, DBS_WIDTH_BOUNDS)).toBe(288);
    expect(clampPaneWidth(180, DBS_WIDTH_BOUNDS)).toBe(180);
    expect(clampPaneWidth(420, DBS_WIDTH_BOUNDS)).toBe(420);
    expect(clampPaneWidth(224, TABLES_WIDTH_BOUNDS)).toBe(224);
    expect(clampPaneWidth(140, TABLES_WIDTH_BOUNDS)).toBe(140);
    expect(clampPaneWidth(320, TABLES_WIDTH_BOUNDS)).toBe(320);
  });

  it("clamps below-minimum values to the pane minimum", () => {
    expect(clampPaneWidth(40, TABLES_WIDTH_BOUNDS)).toBe(140);
    expect(clampPaneWidth(40, DBS_WIDTH_BOUNDS)).toBe(180);
  });

  it("clamps above-maximum values to the pane maximum", () => {
    expect(clampPaneWidth(900, DBS_WIDTH_BOUNDS)).toBe(420);
    expect(clampPaneWidth(900, TABLES_WIDTH_BOUNDS)).toBe(320);
  });

  it("falls back to the pane default for NaN input", () => {
    expect(clampPaneWidth(Number.NaN, DBS_WIDTH_BOUNDS)).toBe(288);
    expect(clampPaneWidth(Number.NaN, TABLES_WIDTH_BOUNDS)).toBe(224);
  });
});

describe("resolvePaneWidth", () => {
  it("resolves a collapsed pane to the rail width regardless of stored width", () => {
    expect(resolvePaneWidth({ collapsed: true, width: 288, bounds: DBS_WIDTH_BOUNDS })).toBe(RAIL_WIDTH);
    expect(resolvePaneWidth({ collapsed: true, width: 900, bounds: TABLES_WIDTH_BOUNDS })).toBe(RAIL_WIDTH);
  });

  it("resolves an expanded pane to the clamped width", () => {
    expect(resolvePaneWidth({ collapsed: false, width: 350, bounds: DBS_WIDTH_BOUNDS })).toBe(350);
    expect(resolvePaneWidth({ collapsed: false, width: 260, bounds: TABLES_WIDTH_BOUNDS })).toBe(260);
    expect(resolvePaneWidth({ collapsed: false, width: 900, bounds: DBS_WIDTH_BOUNDS })).toBe(420);
  });

  it("resolves an expanded pane with garbage width to the pane default", () => {
    expect(resolvePaneWidth({ collapsed: false, width: Number.NaN, bounds: DBS_WIDTH_BOUNDS })).toBe(288);
    expect(resolvePaneWidth({ collapsed: false, width: Number.NaN, bounds: TABLES_WIDTH_BOUNDS })).toBe(224);
  });
});

describe("clampDockHeight", () => {
  it("returns the input when it is within bounds", () => {
    expect(clampDockHeight(320, 800)).toBe(320);
    expect(clampDockHeight(120, 800)).toBe(120);
    expect(clampDockHeight(560, 800)).toBe(560);
  });

  it("clamps values below the 120px minimum", () => {
    expect(clampDockHeight(80, 800)).toBe(120);
    expect(clampDockHeight(0, 800)).toBe(120);
  });

  it("clamps values above the container-derived maximum", () => {
    expect(clampDockHeight(600, 800)).toBe(560);
    expect(clampDockHeight(500, 600)).toBe(420);
  });

  it("keeps the maximum at the minimum for small containers", () => {
    expect(clampDockHeight(130, 150)).toBe(120);
    expect(clampDockHeight(200, 150)).toBe(120);
  });

  it("falls back to the default height for NaN input", () => {
    expect(clampDockHeight(Number.NaN, 800)).toBe(320);
  });
});

describe("defaultDockHeight", () => {
  it("floors 40 percent of the container height", () => {
    expect(defaultDockHeight(800)).toBe(320);
    expect(defaultDockHeight(813)).toBe(325);
  });
});

describe("isRunShortcut", () => {
  it("returns true for Enter with meta or ctrl", () => {
    expect(isRunShortcut({ key: "Enter", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isRunShortcut({ key: "Enter", metaKey: false, ctrlKey: true })).toBe(true);
  });

  it("returns false for plain Enter and for modifiers without Enter", () => {
    expect(isRunShortcut({ key: "Enter", metaKey: false, ctrlKey: false })).toBe(false);
    expect(isRunShortcut({ key: "a", metaKey: true, ctrlKey: false })).toBe(false);
    expect(isRunShortcut({ key: "Enter", metaKey: false, ctrlKey: false })).toBe(false);
  });
});

describe("parseDbLayout and serializeDbLayout", () => {
  it("round-trips a full non-default layout field for field", () => {
    const layout = {
      dbsCollapsed: true,
      dbsWidth: 350,
      tablesCollapsed: true,
      tablesWidth: 260,
      sqlDockHeight: 250,
    };
    expect(parseDbLayout(serializeDbLayout(layout))).toEqual(layout);
  });

  it("round-trips the default layout with a null dock height", () => {
    expect(parseDbLayout(serializeDbLayout(DEFAULT_DB_LAYOUT))).toEqual(DEFAULT_DB_LAYOUT);
  });

  it("returns null for null, garbage, and non-object payloads", () => {
    expect(parseDbLayout(null)).toBeNull();
    expect(parseDbLayout("garbage")).toBeNull();
    expect(parseDbLayout("42")).toBeNull();
    expect(parseDbLayout('"garbage"')).toBeNull();
    expect(parseDbLayout('{"dbsWidth": NaN}')).toBeNull();
  });

  it("returns an empty partial for an empty object payload", () => {
    expect(parseDbLayout("{}")).toEqual({});
  });

  it("drops type-invalid width fields", () => {
    expect(parseDbLayout('{"dbsWidth": "288"}')).toEqual({});
    expect(parseDbLayout('{"dbsWidth": true}')).toEqual({});
    expect(parseDbLayout('{"tablesWidth": 1e999}')).toEqual({});
  });

  it("keeps only the type-valid fields of a mixed payload", () => {
    expect(
      parseDbLayout('{"dbsCollapsed": true, "dbsWidth": 350, "tablesCollapsed": "yes", "sqlDockHeight": "250"}'),
    ).toEqual({ dbsCollapsed: true, dbsWidth: 350 });
  });

  it("accepts a finite number or null for sqlDockHeight only", () => {
    expect(parseDbLayout('{"sqlDockHeight": 250}')).toEqual({ sqlDockHeight: 250 });
    expect(parseDbLayout('{"sqlDockHeight": null}')).toEqual({ sqlDockHeight: null });
    expect(parseDbLayout('{"sqlDockHeight": 1e999}')).toEqual({});
  });
});

describe("loadDbLayout and saveDbLayout", () => {
  it("round-trips every field including null and non-default values", () => {
    stubStorage();
    const layout = {
      dbsCollapsed: true,
      dbsWidth: 350,
      tablesCollapsed: true,
      tablesWidth: 260,
      sqlDockHeight: 250,
    };
    saveDbLayout(layout);
    expect(loadDbLayout()).toEqual(layout);
    saveDbLayout(DEFAULT_DB_LAYOUT);
    expect(loadDbLayout()).toEqual(DEFAULT_DB_LAYOUT);
  });

  it("falls back to the default layout for a missing key", () => {
    stubStorage();
    expect(loadDbLayout()).toEqual(DEFAULT_DB_LAYOUT);
  });

  it("falls back to the default layout for corrupt JSON", () => {
    stubStorage({ "beholder.dbLayout": "garbage" });
    expect(loadDbLayout()).toEqual(DEFAULT_DB_LAYOUT);
  });

  it("merges defaults for an empty object payload", () => {
    stubStorage({ "beholder.dbLayout": "{}" });
    expect(loadDbLayout()).toEqual(DEFAULT_DB_LAYOUT);
  });
});
