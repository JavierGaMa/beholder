import type { QueryResult } from "../../queries/databases";

export interface TabResult {
  result: QueryResult | null;
  error: string | null;
  lastRunSql: string | null;
  page: number;
  total: number | null;
  activeTable: string | null;
  running: boolean;
  runId: number;
}

export type TabResults = Record<string, TabResult>;

export type RunOutcome = Partial<Pick<TabResult, "result" | "error" | "page" | "total">>;

export const EMPTY_TAB_RESULT: TabResult = {
  result: null,
  error: null,
  lastRunSql: null,
  page: 0,
  total: null,
  activeTable: null,
  running: false,
  runId: 0,
};

export function tabResultFor(results: TabResults, tabId: string): TabResult {
  return results[tabId] ?? EMPTY_TAB_RESULT;
}

export function beginRun(
  results: TabResults,
  tabId: string,
  runId: number,
  query?: { sql: string; activeTable?: string | null },
): TabResults {
  const current = tabResultFor(results, tabId);
  const next: TabResult = { ...current, running: true, runId };
  if (query != null) {
    next.lastRunSql = query.sql;
    next.page = 0;
    next.total = null;
    if (query.activeTable !== undefined) next.activeTable = query.activeTable;
  }
  return { ...results, [tabId]: next };
}

export function settleRun(
  results: TabResults,
  tabId: string,
  runId: number,
  outcome: RunOutcome,
): TabResults {
  const current = results[tabId];
  if (current == null || current.runId !== runId) return results;
  return { ...results, [tabId]: { ...current, ...outcome, running: false } };
}

export function setTabTotal(
  results: TabResults,
  tabId: string,
  sourceSql: string,
  total: number,
): TabResults {
  const current = results[tabId];
  if (current == null || current.lastRunSql !== sourceSql) return results;
  return { ...results, [tabId]: { ...current, total } };
}

export function setTabActiveTable(
  results: TabResults,
  tabId: string,
  activeTable: string | null,
): TabResults {
  return { ...results, [tabId]: { ...tabResultFor(results, tabId), activeTable } };
}

export function retainTabResults(results: TabResults, tabIds: readonly string[]): TabResults {
  const keep = new Set(tabIds);
  const ids = Object.keys(results);
  if (ids.every((id) => keep.has(id))) return results;
  const next: TabResults = {};
  for (const id of ids) {
    if (keep.has(id)) next[id] = results[id];
  }
  return next;
}

export function clearTabResults(): TabResults {
  return {};
}
