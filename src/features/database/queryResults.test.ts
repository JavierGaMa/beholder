import { describe, expect, it } from "vitest";
import {
  csvEscapeField,
  exportBaseName,
  formatCsv,
  formatMarkdownTable,
  resultSummary,
} from "./queryResults";
import type { QueryResult } from "../../queries/databases";

function qr(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: [],
    rows: [],
    row_count: 0,
    truncated: false,
    elapsed_ms: 0,
    ...overrides,
  };
}

describe("csvEscapeField", () => {
  it("passes plain fields through unchanged", () => {
    expect(csvEscapeField("hello")).toBe("hello");
    expect(csvEscapeField("123")).toBe("123");
    expect(csvEscapeField(" leading and trailing ")).toBe(" leading and trailing ");
  });

  it("quotes fields containing a comma", () => {
    expect(csvEscapeField("a,b")).toBe('"a,b"');
  });

  it("quotes fields and doubles embedded double quotes", () => {
    expect(csvEscapeField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes fields containing newlines", () => {
    expect(csvEscapeField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscapeField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
});

describe("formatCsv", () => {
  it("maps cell kinds to csv text", () => {
    const out = formatCsv(
      ["id", "name", "ok"],
      [
        [1, "ada", true],
        [2.5, null, false],
        [3, undefined, "yes"],
      ],
    );
    expect(out).toBe("id,name,ok\n1,ada,true\n2.5,,false\n3,,yes\n");
  });

  it("escapes commas, quotes and newlines inside values", () => {
    const out = formatCsv(["a,b", 'q"uote', "plain"], [["x,y", 'he said "no"', "multi\nline"]]);
    expect(out).toBe('"a,b","q""uote",plain\n"x,y","he said ""no""","multi\nline"\n');
  });

  it("serializes structured cells as json", () => {
    const out = formatCsv(["doc"], [[{ a: 1 }], [[1, 2]]]);
    expect(out).toBe('doc\n"{""a"":1}"\n"[1,2]"\n');
  });

  it("keeps unicode untouched without bom", () => {
    const out = formatCsv(["名前"], [["ñ"]]);
    expect(out).toBe("名前\nñ\n");
  });

  it("writes a header-only file for an empty result", () => {
    expect(formatCsv(["a", "b"], [])).toBe("a,b\n");
  });
});

describe("formatMarkdownTable", () => {
  it("renders header, separator and rows as a pipe table", () => {
    const out = formatMarkdownTable(["id", "name"], [
      [1, "ada"],
      [2, null],
    ]);
    expect(out).toBe("| id | name |\n| --- | --- |\n| 1 | ada |\n| 2 |  |\n");
  });

  it("escapes pipes and newlines inside cells", () => {
    const out = formatMarkdownTable(["a|b", "plain"], [["x|y", "line1\nline2"]]);
    expect(out).toBe("| a\\|b | plain |\n| --- | --- |\n| x\\|y | line1<br>line2 |\n");
  });

  it("collapses crlf newlines into a single line break", () => {
    const out = formatMarkdownTable(["col"], [["l1\r\nl2\r"]]);
    expect(out).toBe("| col |\n| --- |\n| l1<br>l2<br> |\n");
  });

  it("renders booleans, numbers and missing values", () => {
    const out = formatMarkdownTable(["x", "y", "z"], [[true, 3.5, undefined]]);
    expect(out).toBe("| x | y | z |\n| --- | --- | --- |\n| true | 3.5 |  |\n");
  });

  it("writes header and separator only for an empty result", () => {
    expect(formatMarkdownTable(["a", "b"], [])).toBe("| a | b |\n| --- | --- |\n");
  });
});

describe("resultSummary", () => {
  it("formats row counts with grouping and elapsed milliseconds", () => {
    expect(resultSummary(qr({ row_count: 1234, elapsed_ms: 56 }))).toBe("1,234 rows · 56 ms");
  });

  it("handles zero rows and sub-millisecond queries", () => {
    expect(resultSummary(qr({ row_count: 0, elapsed_ms: 0 }))).toBe("0 rows · 0 ms");
  });
});

describe("exportBaseName", () => {
  it("embeds a sortable local timestamp without an extension", () => {
    expect(exportBaseName(new Date(2026, 8, 27, 14, 3, 5))).toBe("query-20260927-140305");
  });

  it("pads single-digit components", () => {
    expect(exportBaseName(new Date(2026, 0, 2, 1, 2, 3))).toBe("query-20260102-010203");
  });
});
