import { describe, expect, it } from "vitest";
import {
  appendPending,
  cellLiteral,
  cellUpdateSql,
  cellValueFromInput,
  clearPending,
  deleteRowSql,
  isWriteStatement,
  type PendingWrite,
} from "./writes";

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

describe("cellLiteral", () => {
  it("renders numbers raw and null as NULL", () => {
    expect(cellLiteral(5)).toBe("5");
    expect(cellLiteral(-1.5)).toBe("-1.5");
    expect(cellLiteral(0)).toBe("0");
    expect(cellLiteral(null)).toBe("NULL");
  });

  it("single-quotes text and escapes embedded quotes", () => {
    expect(cellLiteral("abc")).toBe("'abc'");
    expect(cellLiteral("it's")).toBe("'it''s'");
    expect(cellLiteral("row 'a' and 'b'")).toBe("'row ''a'' and ''b'''");
    expect(cellLiteral("123")).toBe("'123'");
  });
});

describe("cellValueFromInput", () => {
  it("maps empty input to null", () => {
    expect(cellValueFromInput("", 3)).toBeNull();
    expect(cellValueFromInput("", "text")).toBeNull();
  });

  it("keeps numeric cells numeric when the input parses", () => {
    expect(cellValueFromInput("42", 3)).toBe(42);
    expect(cellValueFromInput("  7 ", 7)).toBe(7);
    expect(cellValueFromInput("-2.5", 0.5)).toBe(-2.5);
  });

  it("keeps text cells textual even when the input looks numeric", () => {
    expect(cellValueFromInput("42", "42")).toBe("42");
    expect(cellValueFromInput("007", "007")).toBe("007");
  });

  it("falls back to text when a numeric cell receives non-numeric input", () => {
    expect(cellValueFromInput("abc", 3)).toBe("abc");
    expect(cellValueFromInput("1e", 3)).toBe("1e");
  });
});

describe("cellUpdateSql", () => {
  it("builds a rowid-targeted update", () => {
    expect(cellUpdateSql("users", "name", "Ada", 3)).toBe(
      'UPDATE "users" SET "name" = \'Ada\' WHERE rowid = 3',
    );
  });

  it("embeds numbers raw and nulls as NULL", () => {
    expect(cellUpdateSql("users", "id", 7, 3)).toBe(
      'UPDATE "users" SET "id" = 7 WHERE rowid = 3',
    );
    expect(cellUpdateSql("users", "note", null, 3)).toBe(
      'UPDATE "users" SET "note" = NULL WHERE rowid = 3',
    );
  });

  it("quotes and escapes exotic table and column names", () => {
    expect(cellUpdateSql('od"d', 'sel"ect', "x", 1)).toBe(
      'UPDATE "od""d" SET "sel""ect" = \'x\' WHERE rowid = 1',
    );
  });
});

describe("deleteRowSql", () => {
  it("builds a rowid-targeted delete", () => {
    expect(deleteRowSql("users", 3)).toBe('DELETE FROM "users" WHERE rowid = 3');
  });

  it("quotes and escapes exotic table names", () => {
    expect(deleteRowSql('od"d', 1)).toBe('DELETE FROM "od""d" WHERE rowid = 1');
  });
});
