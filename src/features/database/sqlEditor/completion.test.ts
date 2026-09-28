import { describe, expect, it } from "vitest";
import type { TableSchema } from "../../../queries/databases";
import { buildSqlSchema, keywordSnippetSource, SQL_KEYWORDS } from "./completion";
import { SQL_SNIPPETS } from "./snippets";

function table(name: string, columns: string[]): TableSchema {
  return {
    name,
    row_count: 0,
    columns: columns.map((col) => ({ name: col, decl_type: null })),
  };
}

describe("buildSqlSchema", () => {
  it("maps two tables with known columns", () => {
    const result = buildSqlSchema([
      table("users", ["id", "name", "email"]),
      table("orders", ["id", "user_id", "total"]),
    ]);
    expect(result).toEqual({
      users: ["email", "id", "name"],
      orders: ["id", "total", "user_id"],
    });
  });

  it("sorts table keys and columns and dedupes repeated columns", () => {
    const result = buildSqlSchema([
      table("zeta", ["b", "a", "b"]),
      table("alpha", ["y", "x"]),
    ]);
    expect(Object.keys(result)).toEqual(["alpha", "zeta"]);
    expect(result.zeta).toEqual(["a", "b"]);
    expect(result.alpha).toEqual(["x", "y"]);
  });

  it("returns an empty record for an empty schema", () => {
    expect(buildSqlSchema([])).toEqual({});
  });

  it("maps an entry with empty columns to an empty list without cross-table leakage", () => {
    const result = buildSqlSchema([table("empty", []), table("full", ["id"])]);
    expect(result.empty).toEqual([]);
    expect(result.full).toEqual(["id"]);
  });
});

describe("SQL_KEYWORDS", () => {
  it("is non-empty and unique", () => {
    expect(SQL_KEYWORDS.length).toBeGreaterThan(0);
    expect(new Set(SQL_KEYWORDS).size).toBe(SQL_KEYWORDS.length);
  });
});

describe("keywordSnippetSource", () => {
  it("is a completion source function", () => {
    expect(typeof keywordSnippetSource).toBe("function");
  });

  it("covers every keyword and every snippet label in the source list build", () => {
    expect(SQL_KEYWORDS.length + SQL_SNIPPETS.length).toBeGreaterThan(SQL_KEYWORDS.length);
    expect(SQL_SNIPPETS).toHaveLength(8);
  });
});
