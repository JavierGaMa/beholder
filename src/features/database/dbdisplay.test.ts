import { describe, expect, it } from "vitest";
import {
  classifyCell,
  clampPage,
  columnTitle,
  formatPulledAt,
  formatRowCount,
  humanizeSize,
  joinExportPath,
  nextOrderState,
  normalizeSearch,
  pageCount,
  prefillQuery,
  pushHistory,
  queryResultToPage,
  shortPackage,
  snapshotKey,
  sortDatabases,
} from "./dbdisplay";
import type { DbFile, TableColumn } from "../../queries/databases";

function db(name: string, sizeBytes = 1024, hasWal = false): DbFile {
  return { name, size_bytes: sizeBytes, has_wal: hasWal };
}

describe("humanizeSize", () => {
  it("renders bytes below 1 KB", () => {
    expect(humanizeSize(0)).toBe("0 B");
    expect(humanizeSize(512)).toBe("512 B");
    expect(humanizeSize(1023)).toBe("1023 B");
  });

  it("renders kilobytes with one decimal", () => {
    expect(humanizeSize(1024)).toBe("1.0 KB");
    expect(humanizeSize(2048)).toBe("2.0 KB");
    expect(humanizeSize(2560)).toBe("2.5 KB");
  });

  it("renders megabytes with one decimal", () => {
    expect(humanizeSize(1024 * 1024)).toBe("1.0 MB");
    expect(humanizeSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("renders gigabytes with two decimals", () => {
    expect(humanizeSize(1536 * 1024 * 1024)).toBe("1.50 GB");
  });
});

describe("pageCount", () => {
  it("returns zero pages for an empty table", () => {
    expect(pageCount(0, 50)).toBe(0);
  });

  it("returns one page when rows fit exactly in one page", () => {
    expect(pageCount(1, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
  });

  it("spills the remainder into an extra page", () => {
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(120, 50)).toBe(3);
  });

  it("guards against a non-positive page size", () => {
    expect(pageCount(10, 0)).toBe(0);
    expect(pageCount(10, -1)).toBe(0);
  });
});

describe("clampPage", () => {
  it("keeps valid pages unchanged", () => {
    expect(clampPage(0, 120, 50)).toBe(0);
    expect(clampPage(1, 120, 50)).toBe(1);
    expect(clampPage(2, 120, 50)).toBe(2);
  });

  it("clamps pages past the last page", () => {
    expect(clampPage(5, 120, 50)).toBe(2);
    expect(clampPage(3, 51, 50)).toBe(1);
  });

  it("clamps negative pages to zero", () => {
    expect(clampPage(-2, 120, 50)).toBe(0);
  });

  it("clamps to zero for an empty table", () => {
    expect(clampPage(0, 0, 50)).toBe(0);
    expect(clampPage(4, 0, 50)).toBe(0);
  });
});

describe("sortDatabases", () => {
  it("sorts alphabetically by name", () => {
    const out = sortDatabases([db("users.db"), db("app.db"), db("logs.db")]);
    expect(out.map((d) => d.name)).toEqual(["app.db", "logs.db", "users.db"]);
  });

  it("orders case-insensitively", () => {
    const out = sortDatabases([db("Beta.db"), db("alpha.db")]);
    expect(out.map((d) => d.name)).toEqual(["alpha.db", "Beta.db"]);
  });

  it("does not mutate the input array", () => {
    const input = [db("b.db"), db("a.db")];
    sortDatabases(input);
    expect(input.map((d) => d.name)).toEqual(["b.db", "a.db"]);
  });
});

describe("shortPackage", () => {
  it("returns the last segment of a package name", () => {
    expect(shortPackage("com.example.app")).toBe("app");
  });

  it("returns the whole string when there are no dots", () => {
    expect(shortPackage("single")).toBe("single");
  });
});

describe("classifyCell", () => {
  it("classifies null and undefined as null", () => {
    expect(classifyCell(null)).toEqual({ kind: "null", text: "null" });
    expect(classifyCell(undefined)).toEqual({ kind: "null", text: "null" });
  });

  it("classifies numbers", () => {
    expect(classifyCell(42)).toEqual({ kind: "number", text: "42" });
    expect(classifyCell(-1.5)).toEqual({ kind: "number", text: "-1.5" });
  });

  it("classifies blob size markers", () => {
    expect(classifyCell("<12 bytes>")).toEqual({ kind: "blob", text: "<12 bytes>" });
    expect(classifyCell("<0 bytes>")).toEqual({ kind: "blob", text: "<0 bytes>" });
  });

  it("classifies plain text and text that merely contains a marker", () => {
    expect(classifyCell("hello")).toEqual({ kind: "text", text: "hello" });
    expect(classifyCell("x <12 bytes> y")).toEqual({ kind: "text", text: "x <12 bytes> y" });
    expect(classifyCell("<12 bytes")).toEqual({ kind: "text", text: "<12 bytes" });
  });
});

describe("columnTitle", () => {
  it("appends the declared type when present", () => {
    const col: TableColumn = { name: "id", decl_type: "INTEGER" };
    expect(columnTitle(col)).toBe("id · INTEGER");
  });

  it("returns the bare name when the type is unknown", () => {
    const col: TableColumn = { name: "value", decl_type: null };
    expect(columnTitle(col)).toBe("value");
  });
});

describe("formatRowCount", () => {
  it("groups thousands separators", () => {
    expect(formatRowCount(0)).toBe("0");
    expect(formatRowCount(1234567)).toBe("1,234,567");
  });
});

describe("formatPulledAt", () => {
  it("formats a fixed HH:MM:SS string in local time", () => {
    const ts = new Date(2026, 8, 21, 14, 3, 5).getTime();
    expect(formatPulledAt(ts)).toBe("14:03:05");
  });

  it("pads single-digit components", () => {
    const ts = new Date(2026, 0, 2, 1, 2, 3).getTime();
    expect(formatPulledAt(ts)).toBe("01:02:03");
  });
});

describe("snapshotKey", () => {
  it("is unique per serial, package and database", () => {
    expect(snapshotKey("emu-1", "com.a", "x.db")).not.toBe(snapshotKey("emu-2", "com.a", "x.db"));
    expect(snapshotKey("emu-1", "com.a", "x.db")).not.toBe(snapshotKey("emu-1", "com.b", "x.db"));
    expect(snapshotKey("emu-1", "com.a", "x.db")).not.toBe(snapshotKey("emu-1", "com.a", "y.db"));
  });

  it("tolerates slashes inside components without collisions", () => {
    expect(snapshotKey("emu/1", "com.a", "x.db")).not.toBe(snapshotKey("emu", "1/com.a", "x.db"));
  });
});

describe("joinExportPath", () => {
  it("joins with a slash when the dir has no trailing separator", () => {
    expect(joinExportPath("/Users/x/Downloads", "app.db")).toBe("/Users/x/Downloads/app.db");
  });

  it("does not double the separator when the dir ends with one", () => {
    expect(joinExportPath("/Users/x/Downloads/", "app.db")).toBe("/Users/x/Downloads/app.db");
    expect(joinExportPath("C:\\Users\\x", "app.db")).toBe("C:\\Users\\x/app.db");
  });
});

describe("nextOrderState", () => {
  it("starts ascending on first click", () => {
    expect(nextOrderState("id", null)).toEqual({ col: "id", dir: "asc" });
  });

  it("starts ascending when a different column is active", () => {
    expect(nextOrderState("name", { col: "id", dir: "desc" })).toEqual({
      col: "name",
      dir: "asc",
    });
  });

  it("toggles ascending to descending on the same column", () => {
    expect(nextOrderState("id", { col: "id", dir: "asc" })).toEqual({ col: "id", dir: "desc" });
  });

  it("clears ordering on the third click of the same column", () => {
    expect(nextOrderState("id", { col: "id", dir: "desc" })).toBeNull();
  });
});

describe("normalizeSearch", () => {
  it("returns null for empty and whitespace-only input", () => {
    expect(normalizeSearch("")).toBeNull();
    expect(normalizeSearch("   ")).toBeNull();
    expect(normalizeSearch("\t\n")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeSearch("  ada  ")).toBe("ada");
  });

  it("passes like wildcards and backslashes through unescaped", () => {
    expect(normalizeSearch("a%b_c\\d")).toBe("a%b_c\\d");
    expect(normalizeSearch("100%")).toBe("100%");
  });
});

describe("prefillQuery", () => {
  it("returns an empty string without a table", () => {
    expect(prefillQuery(null)).toBe("");
  });

  it("builds a quoted select with limit 50", () => {
    expect(prefillQuery("users")).toBe('SELECT * FROM "users" LIMIT 50');
  });

  it("escapes embedded double quotes in the table name", () => {
    expect(prefillQuery('weird "quoted"')).toBe(
      'SELECT * FROM "weird ""quoted""" LIMIT 50',
    );
  });
});

describe("pushHistory", () => {
  it("prepends the newest entry", () => {
    expect(pushHistory(["SELECT 1"], "SELECT 2")).toEqual(["SELECT 2", "SELECT 1"]);
  });

  it("ignores empty and whitespace-only sql without changing the reference", () => {
    const history = ["SELECT 1"];
    expect(pushHistory(history, "   ")).toBe(history);
    expect(pushHistory(history, "")).toBe(history);
  });

  it("trims entries before storing them", () => {
    expect(pushHistory([], "  SELECT 1  ")).toEqual(["SELECT 1"]);
  });

  it("removes an earlier duplicate instead of keeping both", () => {
    const history = ["SELECT 1", "SELECT 2", "SELECT 3"];
    expect(pushHistory(history, "SELECT 2")).toEqual(["SELECT 2", "SELECT 1", "SELECT 3"]);
  });

  it("caps the history at 10 entries", () => {
    let history: string[] = [];
    for (let i = 1; i <= 12; i++) history = pushHistory(history, `SELECT ${i}`);
    expect(history).toHaveLength(10);
    expect(history[0]).toBe("SELECT 12");
    expect(history).not.toContain("SELECT 1");
    expect(history).not.toContain("SELECT 2");
    expect(history).toContain("SELECT 3");
  });
});

describe("queryResultToPage", () => {
  it("maps arrays-per-row to the table page shape", () => {
    const page = queryResultToPage({
      columns: ["id", "name"],
      rows: [
        [1, "ada"],
        [2, null],
      ],
      row_count: 2,
      truncated: false,
      elapsed_ms: 4,
    });
    expect(page.columns).toEqual([
      { name: "id", decl_type: null },
      { name: "name", decl_type: null },
    ]);
    expect(page.rows).toEqual([
      { id: 1, name: "ada" },
      { id: 2, name: null },
    ]);
    expect(page.total_rows).toBe(2);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(2);
  });

  it("keeps an empty result renderable with zero rows", () => {
    const page = queryResultToPage({
      columns: ["a"],
      rows: [],
      row_count: 0,
      truncated: false,
      elapsed_ms: 1,
    });
    expect(page.rows).toEqual([]);
    expect(page.columns).toEqual([{ name: "a", decl_type: null }]);
    expect(page.total_rows).toBe(0);
  });
});
