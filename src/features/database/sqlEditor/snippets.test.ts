import { describe, expect, it } from "vitest";
import { applySnippet, SQL_SNIPPETS } from "./snippets";

const EXPECTED_LABELS = [
  "select star",
  "select where",
  "order by",
  "limit",
  "count",
  "join",
  "insert into",
  "update where",
];

describe("SQL_SNIPPETS", () => {
  it("has exactly 8 entries covering the curated set", () => {
    expect(SQL_SNIPPETS).toHaveLength(8);
    expect(SQL_SNIPPETS.map((s) => s.label)).toEqual(EXPECTED_LABELS);
  });

  it("every entry has a non-empty label, a non-empty template, and the {table} token", () => {
    for (const snippet of SQL_SNIPPETS) {
      expect(snippet.label.trim().length).toBeGreaterThan(0);
      expect(snippet.template.trim().length).toBeGreaterThan(0);
      expect(snippet.template).toContain("{table}");
    }
  });
});

describe("applySnippet", () => {
  it("returns every template usable with the token visible when no table is given", () => {
    for (const snippet of SQL_SNIPPETS) {
      const applied = applySnippet(snippet.template);
      expect(applied).toBe(snippet.template);
      expect(applied).toContain("{table}");
    }
  });

  it("interpolates the quote-escaped identifier for every template", () => {
    for (const snippet of SQL_SNIPPETS) {
      const applied = applySnippet(snippet.template, "users");
      expect(applied).not.toContain("{table}");
      expect(applied).toContain('"users"');
    }
  });

  it("escapes embedded double quotes in the table name", () => {
    const applied = applySnippet("SELECT * FROM {table}", 'weird "quoted"');
    expect(applied).toBe('SELECT * FROM "weird ""quoted"""');
  });

  it("replaces every {table} occurrence in the join skeleton", () => {
    const join = SQL_SNIPPETS.find((s) => s.label === "join");
    expect(join).toBeDefined();
    const applied = applySnippet(join!.template, "orders");
    expect(applied.match(/"orders"/g)).toHaveLength(2);
  });
});
