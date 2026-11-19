import { beforeEach, describe, expect, it } from "vitest";
import { useShortcuts } from "./store";

beforeEach(() => {
  useShortcuts.setState({ open: false });
});

describe("shortcuts overlay store", () => {
  it("starts closed", () => {
    expect(useShortcuts.getState().open).toBe(false);
  });

  it("opens on setOpen(true)", () => {
    useShortcuts.getState().setOpen(true);
    expect(useShortcuts.getState().open).toBe(true);
  });

  it("closes on setOpen(false)", () => {
    useShortcuts.getState().setOpen(true);
    useShortcuts.getState().setOpen(false);
    expect(useShortcuts.getState().open).toBe(false);
  });

  it("toggles", () => {
    useShortcuts.getState().toggle();
    expect(useShortcuts.getState().open).toBe(true);
    useShortcuts.getState().toggle();
    expect(useShortcuts.getState().open).toBe(false);
  });
});
