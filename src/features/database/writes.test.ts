import { describe, expect, it } from "vitest";
import { appendPending, clearPending, isWriteStatement, type PendingWrite } from "./writes";

function entry(sql: string, changes: number, at: number): PendingWrite {
  return { sql, changes, at };
}

describe("isWriteStatement", () => {
  it("accepts write keywords case-insensitively with leading whitespace", () => {
    expect(isWriteStatement("INSERT INTO t VALUES (1)")).toBe(true);
    expect(isWriteStatement("  \nupdate t set x = 1")).toBe(true);
    expect(isWriteStatement("delete from t")).toBe(true);
    expect(isWriteStatement("Create Table t (x)")).toBe(true);
    expect(isWriteStatement("DROP VIEW v")).toBe(true);
    expect(isWriteStatement("alter table t add column c")).toBe(true);
    expect(isWriteStatement("REPLACE INTO t VALUES (1)")).toBe(true);
    expect(isWriteStatement("TRUNCATE TABLE t")).toBe(true);
  });

  it("rejects reads and non-keyword prefixes", () => {
    expect(isWriteStatement("SELECT * FROM t")).toBe(false);
    expect(isWriteStatement("select rowid, * from \"t\" limit 500")).toBe(false);
    expect(isWriteStatement("EXPLAIN QUERY PLAN SELECT 1")).toBe(false);
    expect(isWriteStatement("PRAGMA table_info(t)")).toBe(false);
    expect(isWriteStatement("selection from somewhere")).toBe(false);
    expect(isWriteStatement("inserted into")).toBe(false);
    expect(isWriteStatement("inserting")).toBe(false);
  });

  it("strips leading comments, whitespace and semicolons", () => {
    expect(isWriteStatement("-- note\nDELETE FROM t")).toBe(true);
    expect(isWriteStatement("/* block */ UPDATE t SET x = 1")).toBe(true);
    expect(isWriteStatement("  ; ; drop table t")).toBe(true);
    expect(isWriteStatement("-- only a comment")).toBe(false);
    expect(isWriteStatement("/* unterminated")).toBe(false);
    expect(isWriteStatement("")).toBe(false);
    expect(isWriteStatement("   ")).toBe(false);
    expect(isWriteStatement(";\n; ")).toBe(false);
  });

  it("accepts keyword directly followed by a parenthesis", () => {
    expect(isWriteStatement("insert(t)")).toBe(true);
    expect(isWriteStatement("delete(t)")).toBe(true);
  });

  it("routes cte-prefixed writes to the read path", () => {
    expect(isWriteStatement("WITH c AS (SELECT 1) INSERT INTO t SELECT * FROM c")).toBe(false);
  });
});

describe("pending writes list", () => {
  it("appends entries without mutating the input", () => {
    const before = [entry("INSERT INTO t VALUES (1)", 1, 1)];
    const after = appendPending(before, entry("DELETE FROM t", 2, 2));
    expect(after).toEqual([
      entry("INSERT INTO t VALUES (1)", 1, 1),
      entry("DELETE FROM t", 2, 2),
    ]);
    expect(before).toHaveLength(1);
  });

  it("clears to an empty list", () => {
    expect(clearPending()).toEqual([]);
  });
});
