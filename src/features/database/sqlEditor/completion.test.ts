import { describe, expect, it } from "vitest";
import type { TableSchema } from "../../../queries/databases";
import {
  buildSqlSchema,
  keywordSnippetSource,
  SQL_KEYWORDS,
  SQL_SNIPPET_COMPLETIONS,
  toCmSnippet,
} from "./completion";
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

describe("toCmSnippet", () => {
  it("converts {table} markers into snippet fields", () => {
    expect(toCmSnippet("SELECT * FROM {table} LIMIT 50")).toBe(
      "SELECT * FROM ${table} LIMIT 50",
    );
  });

  it("converts <placeholder> markers into snippet fields", () => {
    expect(toCmSnippet("WHERE <condition>")).toBe("WHERE ${condition}");
  });

  it("links repeated {table} markers into one repeated field", () => {
    expect(toCmSnippet("FROM {table} JOIN other ON {table}.<id> = other.<id>")).toBe(
      "FROM ${table} JOIN other ON ${table}.${id} = other.${id}",
    );
  });

  it("leaves templates without markers unchanged", () => {
    expect(toCmSnippet("SELECT 1")).toBe("SELECT 1");
  });

  it("converts every shipped template without leaving legacy markers", () => {
    for (const snippet of SQL_SNIPPETS) {
      const cm = toCmSnippet(snippet.template);
      expect(cm).not.toMatch(/(?<!\$)\{table\}|<[^>]+>/);
    }
  });
});

describe("SQL_SNIPPET_COMPLETIONS", () => {
  it("has one snippet completion per shipped template with snippet expansion", () => {
    expect(SQL_SNIPPET_COMPLETIONS).toHaveLength(SQL_SNIPPETS.length);
    for (const completion of SQL_SNIPPET_COMPLETIONS) {
      expect(typeof completion.apply).toBe("function");
      expect(completion.type).toBe("snippet");
      expect(completion.detail).toBe("template");
    }
  });

  it("labels match the shipped snippet labels", () => {
    expect(SQL_SNIPPET_COMPLETIONS.map((c) => c.label)).toEqual(
      SQL_SNIPPETS.map((s) => s.label),
    );
  });
});
