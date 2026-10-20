import { describe, expect, it } from "vitest";
import { formatSql } from "./format";

describe("formatSql", () => {
  it("breaks major clauses onto their own lines", () => {
    const sql = "SELECT id, name FROM users WHERE id > 1 ORDER BY name LIMIT 10";
    const out = formatSql(sql);
    expect(out.split("\n")).toHaveLength(7);
    expect(out).toContain("SELECT");
    expect(out).toMatch(/^FROM users$/m);
    expect(out).toMatch(/^WHERE id > 1$/m);
    expect(out).toMatch(/^ORDER BY name$/m);
    expect(out).toMatch(/^LIMIT 10$/m);
  });

  it("indents select-list items split on top-level commas", () => {
    const out = formatSql("SELECT id, name, email FROM users");
    const lines = out.split("\n");
    expect(lines[0]).toBe("SELECT");
    expect(lines[1]).toBe("  id,");
    expect(lines[2]).toBe("  name,");
    expect(lines[3]).toBe("  email");
    expect(lines[4]).toBe("FROM users");
  });

  it("keeps string literals intact including commas and clause words", () => {
    const out = formatSql("SELECT * FROM logs WHERE msg = 'a, FROM b' AND lvl = 'x'");
    expect(out).toMatch(/^WHERE msg = 'a, FROM b' AND lvl = 'x'$/m);
  });

  it("recognizes lowercase keywords", () => {
    const out = formatSql("select id from users where id > 1");
    expect(out.split("\n")).toHaveLength(4);
    expect(out).toMatch(/^select$/m);
    expect(out).toMatch(/^from users$/m);
    expect(out).toMatch(/^where id > 1$/m);
  });

  it("does not break inside parentheses", () => {
    const out = formatSql("SELECT COUNT(*), MAX(id) FROM t WHERE id IN (1, 2)");
    expect(out).toContain("COUNT(*)");
    expect(out).toContain("id IN (1, 2)");
  });

  it("breaks on join clauses", () => {
    const out = formatSql("SELECT * FROM a LEFT JOIN b ON a.id = b.id");
    expect(out.split("\n")).toHaveLength(4);
    expect(out).toMatch(/^LEFT JOIN b ON a.id = b\.id$/m);
  });

  it("is idempotent", () => {
    const sql =
      "SELECT id, name FROM users WHERE active = 1 ORDER BY name LIMIT 50 OFFSET 0";
    const once = formatSql(sql);
    expect(formatSql(once)).toBe(once);
  });

  it("returns empty output for empty input", () => {
    expect(formatSql("")).toBe("");
    expect(formatSql("   \n  ")).toBe("");
  });

  it("produces no trailing whitespace and no blank lines", () => {
    const out = formatSql("SELECT a, b FROM t");
    for (const line of out.split("\n")) {
      expect(line).toBe(line.trimEnd());
      expect(line.length).toBeGreaterThan(0);
    }
  });
});
