import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAppFilter, syncFocusApp } from "./appfilter";
import type { AppProcess } from "../../store/console-types";
import { invoke } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  isTauri: false,
  invoke: vi.fn(async () => undefined),
}));

function apps(entries: Array<[string, number | null]>): AppProcess[] {
  return entries.map(([pkg, pid]) => ({ package: pkg, pid }));
}

describe("resolveAppFilter", () => {
  it("keeps the filter when the pid is unchanged and resets the miss count", () => {
    const out = resolveAppFilter({ package: "com.foo", pid: 4521, missed: 1 }, apps([["com.foo", 4521]]));
    expect(out).toEqual({ action: "keep", missed: 0 });
  });

  it("keeps the filter on the first missing pid observation", () => {
    const out = resolveAppFilter({ package: "com.foo", pid: 4521, missed: 0 }, apps([["com.foo", null]]));
    expect(out).toEqual({ action: "keep", missed: 1 });
  });

  it("clears the filter after two consecutive missing pid observations", () => {
    const first = resolveAppFilter({ package: "com.foo", pid: 4521, missed: 0 }, apps([["com.foo", null]]));
    expect(first.action).toBe("keep");
    const second = resolveAppFilter(
      { package: "com.foo", pid: 4521, missed: first.missed },
      apps([["com.foo", null]]),
    );
    expect(second).toEqual({ action: "clear", missed: 0 });
  });

  it("resets the miss count when the pid reappears after one miss", () => {
    const out = resolveAppFilter({ package: "com.foo", pid: 4521, missed: 1 }, apps([["com.foo", 4521]]));
    expect(out).toEqual({ action: "keep", missed: 0 });
  });

  it("does not clear on an alternating miss and reappear sequence", () => {
    let missed = 0;
    let outcome = resolveAppFilter({ package: "com.foo", pid: 4521, missed }, apps([["com.foo", null]]));
    missed = outcome.missed;
    outcome = resolveAppFilter({ package: "com.foo", pid: 4521, missed }, apps([["com.foo", 4521]]));
    expect(outcome.action).toBe("keep");
    expect(outcome.missed).toBe(0);
  });

  it("updates the filter when the app restarted with a new pid", () => {
    const out = resolveAppFilter({ package: "com.foo", pid: 4521, missed: 0 }, apps([["com.foo", 9001]]));
    expect(out).toEqual({ action: "update", pid: 9001, missed: 0 });
  });

  it("updates the pid after a restart even while a miss was pending", () => {
    const out = resolveAppFilter({ package: "com.foo", pid: 4521, missed: 1 }, apps([["com.foo", 9001]]));
    expect(out).toEqual({ action: "update", pid: 9001, missed: 0 });
  });

  it("treats a package missing from the list as a dead process", () => {
    const first = resolveAppFilter({ package: "com.gone", pid: 100, missed: 0 }, apps([["com.other", 7]]));
    expect(first).toEqual({ action: "keep", missed: 1 });
    const second = resolveAppFilter({ package: "com.gone", pid: 100, missed: 1 }, apps([["com.other", 7]]));
    expect(second).toEqual({ action: "clear", missed: 0 });
  });
});

describe("syncFocusApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs the selected app package", () => {
    syncFocusApp("com.x");
    expect(invoke).toHaveBeenCalledWith("agent_set_focus_app", { package: "com.x" });
  });

  it("clears the focus app when null", () => {
    syncFocusApp(null);
    expect(invoke).toHaveBeenCalledWith("agent_set_focus_app", { package: null });
  });
});
