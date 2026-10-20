export const MAX_TABS = 10;

export interface SqlTab {
  id: string;
  sql: string;
}

export interface SqlTabs {
  tabs: SqlTab[];
  activeId: string;
}

export const DEFAULT_SQL_TABS: SqlTabs = {
  tabs: [{ id: "q-1", sql: "" }],
  activeId: "q-1",
};

function newTabId(): string {
  return crypto.randomUUID();
}

export function createInitialTabs(): SqlTabs {
  return {
    tabs: DEFAULT_SQL_TABS.tabs.map((t) => ({ ...t })),
    activeId: DEFAULT_SQL_TABS.activeId,
  };
}

export function activeTab(state: SqlTabs): SqlTab {
  return state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];
}

export function addTab(state: SqlTabs): SqlTabs {
  if (state.tabs.length >= MAX_TABS) return state;
  const tab: SqlTab = { id: newTabId(), sql: "" };
  return { tabs: [...state.tabs, tab], activeId: tab.id };
}

export function closeTab(state: SqlTabs, id: string): SqlTabs {
  if (state.tabs.length <= 1) return state;
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (id !== state.activeId) return { tabs, activeId: state.activeId };
  const leftNeighbor = index > 0 ? state.tabs[index - 1] : null;
  return { tabs, activeId: (leftNeighbor ?? tabs[0]).id };
}

export function switchTab(state: SqlTabs, id: string): SqlTabs {
  if (id === state.activeId || !state.tabs.some((t) => t.id === id)) return state;
  return { ...state, activeId: id };
}

export function setActiveTabSql(state: SqlTabs, sql: string): SqlTabs {
  if (!state.tabs.some((t) => t.id === state.activeId)) return state;
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === state.activeId ? { ...t, sql } : t)),
  };
}

export function serializeTabs(state: SqlTabs): string {
  return JSON.stringify(state);
}

export function parseTabs(raw: string | null): SqlTabs {
  const parsed = raw == null ? null : tryParseTabs(raw);
  return parsed ?? createInitialTabs();
}

function tryParseTabs(raw: string): SqlTabs | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  if (!Array.isArray(source.tabs) || source.tabs.length === 0) return null;
  const seen = new Set<string>();
  const tabs: SqlTab[] = [];
  for (const entry of source.tabs) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { id, sql } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id === "") continue;
    if (typeof sql !== "string") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    tabs.push({ id, sql });
  }
  if (tabs.length === 0) return null;
  const capped = tabs.slice(0, MAX_TABS);
  const activeId =
    typeof source.activeId === "string" && capped.some((t) => t.id === source.activeId)
      ? source.activeId
      : capped[0].id;
  return { tabs: capped, activeId };
}

export function migrateLegacySql(sqlText: string | null): SqlTabs {
  const sql = typeof sqlText === "string" ? sqlText : "";
  const tab: SqlTab = { id: newTabId(), sql };
  return { tabs: [tab], activeId: tab.id };
}
