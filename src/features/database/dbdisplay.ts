import type { DbFile, QueryResult, TableColumn, TableOrder, TablePage } from "../../queries/databases";

const BLOB_MARKER_RE = /^<\d+ bytes>$/;

export type CellKind = "null" | "number" | "blob" | "text";

export interface CellDisplay {
  kind: CellKind;
  text: string;
}

export function humanizeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function pageCount(totalRows: number, pageSize: number): number {
  if (pageSize <= 0) return 0;
  return Math.ceil(totalRows / pageSize);
}

export function clampPage(page: number, totalRows: number, pageSize: number): number {
  const last = Math.max(0, pageCount(totalRows, pageSize) - 1);
  return Math.min(Math.max(0, page), last);
}

export function sortDatabases(dbs: DbFile[]): DbFile[] {
  return [...dbs].sort((a, b) => a.name.localeCompare(b.name));
}

export function shortPackage(pkg: string): string {
  const parts = pkg.split(".");
  return parts[parts.length - 1] || pkg;
}

export function classifyCell(value: unknown): CellDisplay {
  if (value == null) return { kind: "null", text: "null" };
  if (typeof value === "number") return { kind: "number", text: String(value) };
  if (typeof value === "string") {
    if (BLOB_MARKER_RE.test(value)) return { kind: "blob", text: value };
    return { kind: "text", text: value };
  }
  return { kind: "text", text: String(value) };
}

export function columnTitle(col: TableColumn): string {
  return col.decl_type ? `${col.name} · ${col.decl_type}` : col.name;
}

export function formatRowCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatPulledAt(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function snapshotKey(serial: string, pkg: string, dbName: string): string {
  return `${serial}\u0000${pkg}\u0000${dbName}`;
}

export function joinExportPath(dir: string, fileName: string): string {
  const trimmed = dir.endsWith("/") || dir.endsWith("\\") ? dir.slice(0, -1) : dir;
  return `${trimmed}/${fileName}`;
}

export function nextOrderState(col: string, current: TableOrder | null): TableOrder | null {
  if (current == null || current.col !== col) return { col, dir: "asc" };
  if (current.dir === "asc") return { col, dir: "desc" };
  return null;
}

export function normalizeSearch(input: string): string | null {
  const trimmed = input.trim();
  return trimmed === "" ? null : trimmed;
}

export function prefillQuery(tableName: string | null): string {
  if (tableName == null) return "";
  return `SELECT * FROM "${tableName.replace(/"/g, '""')}" LIMIT 50`;
}

export function pushHistory(history: string[], sql: string, cap = 10): string[] {
  const trimmed = sql.trim();
  if (trimmed === "") return history;
  return [trimmed, ...history.filter((h) => h !== trimmed)].slice(0, cap);
}

export function queryResultToPage(result: QueryResult): TablePage {
  return {
    columns: result.columns.map((name) => ({ name, decl_type: null })),
    rows: result.rows.map((cells) =>
      Object.fromEntries(result.columns.map((name, i) => [name, cells[i]])),
    ),
    total_rows: result.row_count,
    offset: 0,
    limit: result.row_count,
  };
}
