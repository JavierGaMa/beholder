import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeTab,
  addTab,
  closeTab,
  createInitialTabs,
  DEFAULT_SQL_TABS,
  MAX_TABS,
  migrateLegacySql,
  parseTabs,
  serializeTabs,
  setActiveTabSql,
  switchTab,
  type SqlTab,
  type SqlTabs,
} from "./tabs";
import {
  loadSqlHistory,
  loadSqlTabs,
  saveSqlHistory,
  saveSqlTabs,
} from "../../lib/prefs";

function stubStorage(entries: Record<string, string> = {}) {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  });
}

function state(sqls: string[], activeIndex = 0): SqlTabs {
  const tabs: SqlTab[] = sqls.map((sql, i) => ({ id: `t${i}`, sql }));
  return { tabs, activeId: tabs[activeIndex].id };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DEFAULT_SQL_TABS and createInitialTabs", () => {
  it("pins the default to a single empty tab with a matching active id", () => {
    expect(DEFAULT_SQL_TABS.tabs).toHaveLength(1);
    expect(DEFAULT_SQL_TABS.tabs[0].sql).toBe("");
    expect(DEFAULT_SQL_TABS.activeId).toBe(DEFAULT_SQL_TABS.tabs[0].id);
  });

  it("creates initial tabs equal to the default", () => {
    expect(createInitialTabs()).toEqual(DEFAULT_SQL_TABS);
  });

  it("creates initial tabs as an independent copy of the default", () => {
    const created = createInitialTabs();
    created.tabs[0].sql = "SELECT 1";
    expect(DEFAULT_SQL_TABS.tabs[0].sql).toBe("");
  });

  it("pins the maximum open tabs", () => {
    expect(MAX_TABS).toBe(10);
  });
});

describe("addTab", () => {
  it("appends an empty tab and activates it", () => {
    const next = addTab(state(["SELECT 1"]));
    expect(next.tabs).toHaveLength(2);
    expect(next.tabs[0]).toEqual({ id: "t0", sql: "SELECT 1" });
    expect(next.tabs[1].sql).toBe("");
    expect(next.activeId).toBe(next.tabs[1].id);
  });

  it("mints an id distinct from every existing tab id", () => {
    const next = addTab(state(["a", "b", "c"]));
    const ids = next.tabs.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses to add beyond the cap and keeps the state unchanged", () => {
    const full = state(
      Array.from({ length: MAX_TABS }, (_, i) => `q${i}`),
      3,
    );
    expect(addTab(full)).toEqual(full);
  });
});

describe("closeTab", () => {
  it("refuses to close the last remaining tab", () => {
    const only = state(["SELECT 1"]);
    expect(closeTab(only, "t0")).toEqual(only);
  });

  it("activates the left neighbor when the active tab closes", () => {
    const next = closeTab(state(["a", "b", "c"], 1), "t1");
    expect(next.tabs.map((t) => t.id)).toEqual(["t0", "t2"]);
    expect(next.activeId).toBe("t0");
  });

  it("activates the first remaining tab when the leftmost active tab closes", () => {
    const next = closeTab(state(["a", "b", "c"], 0), "t0");
    expect(next.tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(next.activeId).toBe("t1");
  });

  it("keeps the active tab when a non-active tab closes", () => {
    const next = closeTab(state(["a", "b", "c"], 2), "t0");
    expect(next.tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(next.activeId).toBe("t2");
  });

  it("ignores an unknown id", () => {
    const start = state(["a", "b"], 1);
    expect(closeTab(start, "nope")).toEqual(start);
  });
});

describe("switchTab", () => {
  it("activates the requested tab without touching tab contents", () => {
    const next = switchTab(state(["a", "b"], 0), "t1");
    expect(next.activeId).toBe("t1");
    expect(next.tabs.map((t) => t.sql)).toEqual(["a", "b"]);
  });

  it("ignores an unknown id", () => {
    const start = state(["a", "b"], 0);
    expect(switchTab(start, "nope")).toEqual(start);
  });
});

describe("setActiveTabSql", () => {
  it("replaces only the active tab's sql and keeps the active id", () => {
    const next = setActiveTabSql(state(["a", "b", "c"], 1), "SELECT 2");
    expect(next.tabs.map((t) => t.sql)).toEqual(["a", "SELECT 2", "c"]);
    expect(next.activeId).toBe("t1");
  });
});

describe("activeTab", () => {
  it("returns the active tab", () => {
    expect(activeTab(state(["a", "b"], 1)).id).toBe("t1");
  });

  it("falls back to the first tab when the active id does not match", () => {
    const dangling: SqlTabs = { tabs: [{ id: "t0", sql: "a" }], activeId: "gone" };
    expect(activeTab(dangling).id).toBe("t0");
  });
});

describe("serializeTabs and parseTabs", () => {
  it("round-trips multiple tabs with the active id", () => {
    const start = state(["SELECT 1", "SELECT 2", "SELECT 3"], 1);
    expect(parseTabs(serializeTabs(start))).toEqual(start);
  });

  it("round-trips the default state", () => {
    expect(parseTabs(serializeTabs(DEFAULT_SQL_TABS))).toEqual(DEFAULT_SQL_TABS);
  });

  it("falls back to the default for null, garbage, and non-object payloads", () => {
    expect(parseTabs(null)).toEqual(DEFAULT_SQL_TABS);
    expect(parseTabs("garbage")).toEqual(DEFAULT_SQL_TABS);
    expect(parseTabs("42")).toEqual(DEFAULT_SQL_TABS);
    expect(parseTabs('"garbage"')).toEqual(DEFAULT_SQL_TABS);
    expect(parseTabs("[]")).toEqual(DEFAULT_SQL_TABS);
  });

  it("falls back to the default for an empty tabs array", () => {
    expect(parseTabs('{"tabs":[],"activeId":"x"}')).toEqual(DEFAULT_SQL_TABS);
  });

  it("falls back to the default when the tabs field is not an array", () => {
    expect(parseTabs('{"tabs":"nope"}')).toEqual(DEFAULT_SQL_TABS);
  });

  it("drops entries with invalid shapes and keeps extra fields out", () => {
    const raw = JSON.stringify({
      tabs: [
        { id: "t0", sql: "SELECT 0" },
        "nope",
        null,
        { sql: "no id" },
        { id: "", sql: "empty id" },
        { id: "t3" },
        { id: "t4", sql: 7 },
        { id: "t5", sql: "SELECT 5", extra: true },
      ],
      activeId: "t4",
    });
    const parsed = parseTabs(raw);
    expect(parsed.tabs).toEqual([
      { id: "t0", sql: "SELECT 0" },
      { id: "t5", sql: "SELECT 5" },
    ]);
    expect(parsed.activeId).toBe("t0");
  });

  it("keeps a valid active id", () => {
    const raw = JSON.stringify({
      tabs: [
        { id: "a", sql: "1" },
        { id: "b", sql: "2" },
      ],
      activeId: "b",
    });
    expect(parseTabs(raw).activeId).toBe("b");
  });

  it("falls back to the first tab when the active id does not match", () => {
    const raw = JSON.stringify({
      tabs: [
        { id: "a", sql: "1" },
        { id: "b", sql: "2" },
      ],
      activeId: "zz",
    });
    expect(parseTabs(raw).activeId).toBe("a");
  });

  it("dedupes repeated ids keeping the first entry", () => {
    const raw = JSON.stringify({
      tabs: [
        { id: "a", sql: "first" },
        { id: "a", sql: "second" },
        { id: "b", sql: "other" },
      ],
      activeId: "b",
    });
    expect(parseTabs(raw).tabs).toEqual([
      { id: "a", sql: "first" },
      { id: "b", sql: "other" },
    ]);
  });

  it("caps stored tabs at the maximum and falls back to the first tab", () => {
    const tabs = Array.from({ length: MAX_TABS + 2 }, (_, i) => ({
      id: `t${i}`,
      sql: `q${i}`,
    }));
    const raw = JSON.stringify({ tabs, activeId: `t${MAX_TABS + 1}` });
    const parsed = parseTabs(raw);
    expect(parsed.tabs).toHaveLength(MAX_TABS);
    expect(parsed.tabs[MAX_TABS - 1].id).toBe(`t${MAX_TABS - 1}`);
    expect(parsed.activeId).toBe("t0");
  });

  it("caps stored tabs at the maximum keeping a surviving active id", () => {
    const tabs = Array.from({ length: MAX_TABS + 2 }, (_, i) => ({
      id: `t${i}`,
      sql: `q${i}`,
    }));
    const raw = JSON.stringify({ tabs, activeId: "t2" });
    expect(parseTabs(raw).activeId).toBe("t2");
  });
});

describe("migrateLegacySql", () => {
  it("builds one active tab holding the legacy text", () => {
    const migrated = migrateLegacySql("SELECT 1 FROM users");
    expect(migrated.tabs).toHaveLength(1);
    expect(migrated.tabs[0].sql).toBe("SELECT 1 FROM users");
    expect(migrated.activeId).toBe(migrated.tabs[0].id);
    expect(typeof migrated.tabs[0].id).toBe("string");
    expect(migrated.tabs[0].id).not.toBe("");
  });

  it("accepts null as an empty legacy buffer", () => {
    const migrated = migrateLegacySql(null);
    expect(migrated.tabs).toHaveLength(1);
    expect(migrated.tabs[0].sql).toBe("");
    expect(migrated.activeId).toBe(migrated.tabs[0].id);
  });
});

describe("loadSqlTabs and saveSqlTabs", () => {
  it("round-trips a multi-tab state", () => {
    stubStorage();
    const start = state(["SELECT 1", "SELECT 2", "SELECT 3"], 2);
    saveSqlTabs(start);
    expect(loadSqlTabs()).toEqual(start);
  });

  it("falls back to the default for a missing key", () => {
    stubStorage();
    expect(loadSqlTabs()).toEqual(DEFAULT_SQL_TABS);
  });

  it("falls back to the default for corrupt JSON", () => {
    stubStorage({ "beholder.dbSqlTabs": "garbage" });
    expect(loadSqlTabs()).toEqual(DEFAULT_SQL_TABS);
  });
});

describe("loadSqlHistory and saveSqlHistory", () => {
  it("round-trips the history", () => {
    stubStorage();
    saveSqlHistory(["SELECT 1", "SELECT 2"]);
    expect(loadSqlHistory()).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("returns an empty list for a missing key", () => {
    stubStorage();
    expect(loadSqlHistory()).toEqual([]);
  });

  it("returns an empty list for corrupt JSON", () => {
    stubStorage({ "beholder.dbSqlHistory": "garbage" });
    expect(loadSqlHistory()).toEqual([]);
  });

  it("returns an empty list for a non-array payload", () => {
    stubStorage({ "beholder.dbSqlHistory": '"SELECT 1"' });
    expect(loadSqlHistory()).toEqual([]);
  });

  it("drops entries that are not strings", () => {
    stubStorage({ "beholder.dbSqlHistory": '[1, "SELECT 1", null, true]' });
    expect(loadSqlHistory()).toEqual(["SELECT 1"]);
  });
});
