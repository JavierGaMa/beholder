import { describe, expect, it } from "vitest";
import type { QueryResult } from "../../queries/databases";
import {
  beginRun,
  clearTabResults,
  EMPTY_TAB_RESULT,
  retainTabResults,
  setTabActiveTable,
  setTabTotal,
  settleRun,
  tabResultFor,
  type TabResults,
} from "./tabResults";

function qr(rows: unknown[][], extra: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: ["a"],
    rows,
    row_count: rows.length,
    truncated: false,
    elapsed_ms: 3,
    ...extra,
  };
}

describe("tabResultFor", () => {
  it("returns the empty result for a tab that never ran", () => {
    expect(tabResultFor({}, "t1")).toEqual(EMPTY_TAB_RESULT);
  });

  it("pins the empty result shape", () => {
    expect(EMPTY_TAB_RESULT).toEqual({
      result: null,
      error: null,
      lastRunSql: null,
      page: 0,
      total: null,
      activeTable: null,
      running: false,
      runId: 0,
    });
  });
});

describe("beginRun", () => {
  it("starts a fresh query on one tab without touching the others", () => {
    const other = beginRun({}, "t2", 1, { sql: "SELECT 2" });
    const next = beginRun(other, "t1", 2, { sql: "SELECT 1", activeTable: "users" });
    expect(tabResultFor(next, "t1")).toEqual({
      ...EMPTY_TAB_RESULT,
      lastRunSql: "SELECT 1",
      activeTable: "users",
      running: true,
      runId: 2,
    });
    expect(tabResultFor(next, "t2")).toEqual(tabResultFor(other, "t2"));
  });

  it("resets page and total but keeps the previous result while running", () => {
    let s: TabResults = beginRun({}, "t1", 1, { sql: "SELECT 1" });
    s = settleRun(s, "t1", 1, { result: qr([[1]]), page: 3, total: 9000 });
    s = beginRun(s, "t1", 2, { sql: "SELECT 2" });
    const r = tabResultFor(s, "t1");
    expect(r.lastRunSql).toBe("SELECT 2");
    expect(r.page).toBe(0);
    expect(r.total).toBeNull();
    expect(r.result).toEqual(qr([[1]]));
    expect(r.running).toBe(true);
  });

  it("keeps the active table when none is given and clears it when null is given", () => {
    let s: TabResults = beginRun({}, "t1", 1, { sql: "SELECT 1", activeTable: "users" });
    s = beginRun(s, "t1", 2, { sql: "SELECT 1" });
    expect(tabResultFor(s, "t1").activeTable).toBe("users");
    s = beginRun(s, "t1", 3, { sql: "SELECT 9", activeTable: null });
    expect(tabResultFor(s, "t1").activeTable).toBeNull();
  });

  it("starts a page run without resetting the query, page or total", () => {
    let s: TabResults = beginRun({}, "t1", 1, { sql: "SELECT 1" });
    s = settleRun(s, "t1", 1, { result: qr([[1]]), total: 1200 });
    s = beginRun(s, "t1", 2);
    const r = tabResultFor(s, "t1");
    expect(r.lastRunSql).toBe("SELECT 1");
    expect(r.total).toBe(1200);
    expect(r.running).toBe(true);
    expect(r.runId).toBe(2);
  });
});

describe("settleRun", () => {
  it("stores the result on the tab that ran even after the user switched tabs", () => {
    let s: TabResults = beginRun({}, "t1", 1, { sql: "SELECT 1" });
    s = beginRun(s, "t2", 2, { sql: "SELECT 2" });
    s = settleRun(s, "t2", 2, { result: qr([[2]]), error: null });
    s = settleRun(s, "t1", 1, { result: qr([[1]]), error: null });
    expect(tabResultFor(s, "t1").result).toEqual(qr([[1]]));
    expect(tabResultFor(s, "t2").result).toEqual(qr([[2]]));
    expect(tabResultFor(s, "t1").running).toBe(false);
  });

  it("stores an error and clears the result of that tab only", () => {
    let s: TabResults = beginRun({}, "t1", 1, { sql: "SELECT 1" });
    s = settleRun(s, "t1", 1, { result: qr([[1]]) });
    s = beginRun(s, "t2", 2, { sql: "SELEC" });
    s = settleRun(s, "t2", 2, { result: null, error: "syntax error" });
    expect(tabResultFor(s, "t2")).toMatchObject({ result: null, error: "syntax error", running: false });
    expect(tabResultFor(s, "t1")).toMatchObject({ result: qr([[1]]), error: null });
  });

  it("ignores a stale run superseded by a newer run on the same tab", () => {
    let s: TabResults = beginRun({}, "t1", 1, { sql: "SELECT old" });
    s = beginRun(s, "t1", 2, { sql: "SELECT new" });
    const before = s;
    s = settleRun(s, "t1", 1, { result: qr([["old"]]) });
    expect(s).toBe(before);
    expect(tabResultFor(s, "t1").running).toBe(true);
  });

  it("ignores a run that finishes after its tab was closed", () => {
    let s: TabResults = beginRun({}, "t1", 1, { sql: "SELECT 1" });
    s = retainTabResults(s, ["t2"]);
    s = settleRun(s, "t1", 1, { result: qr([[1]]) });
    expect(s).toEqual({});
  });

  it("ignores a run that finishes after all results were cleared", () => {
    const started = beginRun({}, "t1", 1, { sql: "SELECT 1" });
    expect(tabResultFor(started, "t1").running).toBe(true);
    const s = settleRun(clearTabResults(), "t1", 1, { result: qr([[1]]) });
    expect(tabResultFor(s, "t1")).toEqual(EMPTY_TAB_RESULT);
  });
});

describe("setTabTotal", () => {
  it("sets the total only when the tab still shows the counted query", () => {
    let s: TabResults = beginRun({}, "t1", 1, { sql: "SELECT 1" });
    s = setTabTotal(s, "t1", "SELECT 1", 1234);
    expect(tabResultFor(s, "t1").total).toBe(1234);
  });

  it("drops a count for a query the tab no longer shows", () => {
    let s: TabResults = beginRun({}, "t1", 1, { sql: "SELECT 1" });
    s = beginRun(s, "t1", 2, { sql: "SELECT 2" });
    const before = s;
    expect(setTabTotal(s, "t1", "SELECT 1", 99)).toBe(before);
  });

  it("does not create an entry for an unknown tab", () => {
    expect(setTabTotal({}, "t1", "SELECT 1", 5)).toEqual({});
  });
});

describe("setTabActiveTable", () => {
  it("sets the active table of one tab", () => {
    const s = setTabActiveTable({}, "t1", "orders");
    expect(tabResultFor(s, "t1").activeTable).toBe("orders");
    expect(tabResultFor(s, "t2").activeTable).toBeNull();
  });
});

describe("retainTabResults", () => {
  it("drops the results of closed tabs and keeps the open ones", () => {
    let s: TabResults = beginRun({}, "t1", 1, { sql: "SELECT 1" });
    s = beginRun(s, "t2", 2, { sql: "SELECT 2" });
    s = beginRun(s, "t3", 3, { sql: "SELECT 3" });
    const next = retainTabResults(s, ["t1", "t3"]);
    expect(Object.keys(next).sort()).toEqual(["t1", "t3"]);
    expect(tabResultFor(next, "t2")).toEqual(EMPTY_TAB_RESULT);
  });

  it("returns the same object when nothing was dropped", () => {
    const s = beginRun({}, "t1", 1, { sql: "SELECT 1" });
    expect(retainTabResults(s, ["t1", "t2"])).toBe(s);
  });
});

describe("clearTabResults", () => {
  it("returns an empty map", () => {
    expect(clearTabResults()).toEqual({});
  });
});
