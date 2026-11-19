import { beforeEach, describe, expect, it } from "vitest";
import { MAX_RECENT, usePalette } from "./store";

beforeEach(() => {
  usePalette.setState({ open: false, query: "", activeIndex: 0, recent: [] });
});

describe("palette store open state", () => {
  it("opens and resets query and selection", () => {
    usePalette.setState({ query: "settings", activeIndex: 3 });
    usePalette.getState().setOpen(true);
    const st = usePalette.getState();
    expect(st.open).toBe(true);
    expect(st.query).toBe("");
    expect(st.activeIndex).toBe(0);
  });

  it("closes without touching query state", () => {
    usePalette.getState().setOpen(true);
    usePalette.getState().setQuery("metrics");
    usePalette.getState().setOpen(false);
    const st = usePalette.getState();
    expect(st.open).toBe(false);
    expect(st.query).toBe("metrics");
  });

  it("toggles between open and closed", () => {
    expect(usePalette.getState().open).toBe(false);
    usePalette.getState().toggle();
    expect(usePalette.getState().open).toBe(true);
    usePalette.getState().toggle();
    expect(usePalette.getState().open).toBe(false);
  });
});

describe("palette store query", () => {
  it("updates the query and resets the active index", () => {
    usePalette.getState().setActiveIndex(4);
    usePalette.getState().setQuery("req");
    const st = usePalette.getState();
    expect(st.query).toBe("req");
    expect(st.activeIndex).toBe(0);
  });
});

describe("palette store selection movement", () => {
  it("moves down one step", () => {
    usePalette.getState().setActiveIndex(1);
    usePalette.getState().moveActive("ArrowDown", 4);
    expect(usePalette.getState().activeIndex).toBe(2);
  });

  it("moves up one step", () => {
    usePalette.getState().setActiveIndex(2);
    usePalette.getState().moveActive("ArrowUp", 4);
    expect(usePalette.getState().activeIndex).toBe(1);
  });

  it("wraps from last to first on ArrowDown and first to last on ArrowUp", () => {
    usePalette.getState().setActiveIndex(3);
    usePalette.getState().moveActive("ArrowDown", 4);
    expect(usePalette.getState().activeIndex).toBe(0);
    usePalette.getState().moveActive("ArrowUp", 4);
    expect(usePalette.getState().activeIndex).toBe(3);
  });

  it("selects first on Home and last on End", () => {
    usePalette.getState().setActiveIndex(2);
    usePalette.getState().moveActive("Home", 4);
    expect(usePalette.getState().activeIndex).toBe(0);
    usePalette.getState().moveActive("End", 4);
    expect(usePalette.getState().activeIndex).toBe(3);
  });

  it("keeps the current index for unrelated keys", () => {
    usePalette.getState().setActiveIndex(1);
    usePalette.getState().moveActive("Enter", 4);
    usePalette.getState().moveActive("a", 4);
    expect(usePalette.getState().activeIndex).toBe(1);
  });

  it("selects the first item on ArrowDown from no selection", () => {
    usePalette.setState({ activeIndex: -1 });
    usePalette.getState().moveActive("ArrowDown", 4);
    expect(usePalette.getState().activeIndex).toBe(0);
  });
});

describe("palette store recent commands", () => {
  it("prepends executed command ids", () => {
    usePalette.getState().recordRun("go-to-metrics");
    usePalette.getState().recordRun("open-settings");
    expect(usePalette.getState().recent).toEqual(["open-settings", "go-to-metrics"]);
  });

  it("moves a repeated command to the front without duplicating", () => {
    usePalette.getState().recordRun("go-to-metrics");
    usePalette.getState().recordRun("open-settings");
    usePalette.getState().recordRun("go-to-metrics");
    expect(usePalette.getState().recent).toEqual(["go-to-metrics", "open-settings"]);
  });

  it("caps the history at MAX_RECENT entries", () => {
    for (let i = 0; i < MAX_RECENT + 3; i++) usePalette.getState().recordRun(`cmd-${i}`);
    const recent = usePalette.getState().recent;
    expect(recent.length).toBe(MAX_RECENT);
    expect(recent[0]).toBe(`cmd-${MAX_RECENT + 2}`);
  });
});
