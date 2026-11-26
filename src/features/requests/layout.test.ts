import { afterEach, describe, expect, it, vi } from "vitest";
import { clampPaneWidth, resolvePaneWidth, RAIL_WIDTH } from "../../lib/pane";
import { loadRequestDetailLayout, saveRequestDetailLayout } from "../../lib/prefs";
import {
  DEFAULT_DETAIL_WIDTH,
  DEFAULT_REQUEST_DETAIL_LAYOUT,
  DETAIL_RESIZE_HANDLE_WIDTH,
  DETAIL_WIDTH_BOUNDS,
  LIST_MIN_WIDTH,
  maxDetailWidth,
  parseRequestDetailLayout,
  serializeRequestDetailLayout,
} from "./layout";

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

describe("request detail layout constants", () => {
  it("pins the detail pane bounds and default width", () => {
    expect(DEFAULT_DETAIL_WIDTH).toBe(440);
    expect(DETAIL_WIDTH_BOUNDS).toEqual({ min: 320, max: 720, fallback: 440 });
  });
});

describe("request detail width helpers", () => {
  it("clamps and resolves widths with the detail bounds", () => {
    expect(clampPaneWidth(440, DETAIL_WIDTH_BOUNDS)).toBe(440);
    expect(clampPaneWidth(200, DETAIL_WIDTH_BOUNDS)).toBe(320);
    expect(clampPaneWidth(900, DETAIL_WIDTH_BOUNDS)).toBe(720);
    expect(clampPaneWidth(Number.NaN, DETAIL_WIDTH_BOUNDS)).toBe(440);
    expect(resolvePaneWidth({ collapsed: true, width: 500, bounds: DETAIL_WIDTH_BOUNDS })).toBe(RAIL_WIDTH);
    expect(resolvePaneWidth({ collapsed: false, width: 500, bounds: DETAIL_WIDTH_BOUNDS })).toBe(500);
  });
});

describe("maxDetailWidth", () => {
  it("keeps the absolute max when the container has plenty of room", () => {
    expect(maxDetailWidth(1200)).toBe(DETAIL_WIDTH_BOUNDS.max);
  });

  it("leaves room for the list and resize handle", () => {
    expect(maxDetailWidth(800)).toBe(800 - LIST_MIN_WIDTH - DETAIL_RESIZE_HANDLE_WIDTH);
  });

  it("never goes below the detail minimum", () => {
    expect(maxDetailWidth(300)).toBe(DETAIL_WIDTH_BOUNDS.min);
  });

  it("falls back to the absolute max for invalid container widths", () => {
    expect(maxDetailWidth(Number.NaN)).toBe(DETAIL_WIDTH_BOUNDS.max);
    expect(maxDetailWidth(0)).toBe(DETAIL_WIDTH_BOUNDS.max);
  });
});

describe("parseRequestDetailLayout and serializeRequestDetailLayout", () => {
  it("round-trips a full non-default layout", () => {
    const layout = { collapsed: true, listCollapsed: true, width: 560 };
    expect(parseRequestDetailLayout(serializeRequestDetailLayout(layout))).toEqual(layout);
  });

  it("round-trips the default layout", () => {
    expect(parseRequestDetailLayout(serializeRequestDetailLayout(DEFAULT_REQUEST_DETAIL_LAYOUT))).toEqual(
      DEFAULT_REQUEST_DETAIL_LAYOUT,
    );
  });

  it("returns null for null, garbage, and non-object payloads", () => {
    expect(parseRequestDetailLayout(null)).toBeNull();
    expect(parseRequestDetailLayout("garbage")).toBeNull();
    expect(parseRequestDetailLayout("42")).toBeNull();
    expect(parseRequestDetailLayout('"garbage"')).toBeNull();
  });

  it("returns an empty partial for an empty object payload", () => {
    expect(parseRequestDetailLayout("{}")).toEqual({});
  });

  it("drops type-invalid fields and keeps valid ones", () => {
    expect(parseRequestDetailLayout('{"collapsed": true, "width": "440"}')).toEqual({ collapsed: true });
    expect(parseRequestDetailLayout('{"collapsed": "yes", "width": 500}')).toEqual({ width: 500 });
    expect(parseRequestDetailLayout('{"collapsed": true, "width": 1e999}')).toEqual({ collapsed: true });
    expect(parseRequestDetailLayout('{"listCollapsed": "yes"}')).toEqual({});
  });

  it("parses listCollapsed independently of detail collapsed", () => {
    expect(parseRequestDetailLayout('{"listCollapsed": true}')).toEqual({ listCollapsed: true });
    expect(parseRequestDetailLayout('{"collapsed": false, "listCollapsed": true}')).toEqual({
      collapsed: false,
      listCollapsed: true,
    });
  });
});

describe("loadRequestDetailLayout and saveRequestDetailLayout", () => {
  it("round-trips every field including non-default values", () => {
    stubStorage();
    const layout = { collapsed: true, listCollapsed: true, width: 560 };
    saveRequestDetailLayout(layout);
    expect(loadRequestDetailLayout()).toEqual(layout);
    saveRequestDetailLayout(DEFAULT_REQUEST_DETAIL_LAYOUT);
    expect(loadRequestDetailLayout()).toEqual(DEFAULT_REQUEST_DETAIL_LAYOUT);
  });

  it("falls back to the default layout for a missing key", () => {
    stubStorage();
    expect(loadRequestDetailLayout()).toEqual(DEFAULT_REQUEST_DETAIL_LAYOUT);
  });

  it("falls back to the default layout for corrupt JSON", () => {
    stubStorage({ "beholder.requestDetailLayout": "garbage" });
    expect(loadRequestDetailLayout()).toEqual(DEFAULT_REQUEST_DETAIL_LAYOUT);
  });

  it("merges defaults for an empty object payload", () => {
    stubStorage({ "beholder.requestDetailLayout": "{}" });
    expect(loadRequestDetailLayout()).toEqual(DEFAULT_REQUEST_DETAIL_LAYOUT);
  });
});
