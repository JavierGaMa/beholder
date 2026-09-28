import type { QueryResult } from "../../queries/databases";
import { formatRowCount } from "./dbdisplay";

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value) ?? "";
}

export function csvEscapeField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n") || field.includes("\r")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function formatCsv(columns: string[], rows: unknown[][]): string {
  const lines = [columns.map(csvEscapeField).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => csvEscapeField(cellText(cell))).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export const QUERY_PAGE_SIZE = 500;

const PAGEABLE_START_RE = /^(select|with)\b/i;

function innerQuery(sql: string): string {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
}

export function isPageableQuery(sql: string): boolean {
  return PAGEABLE_START_RE.test(innerQuery(sql));
}

export function wrapCountQuery(sql: string): string {
  return `SELECT COUNT(*) FROM (${innerQuery(sql)})`;
}

export function wrapPageQuery(sql: string, limit: number, offset: number): string {
  return `SELECT * FROM (${innerQuery(sql)}) LIMIT ${limit} OFFSET ${offset}`;
}

export function deriveTotal(
  wrapped: boolean,
  offset: number,
  rowCount: number,
  pageSize: number,
): number | null {
  if (!wrapped) return rowCount;
  if (rowCount >= pageSize) return null;
  return offset + rowCount;
}

export function pageLabel(showingFrom: number, showingTo: number, total: number | null): string {
  const range = `${formatRowCount(showingFrom)}\u2013${formatRowCount(showingTo)}`;
  if (total == null) return `showing ${range}+`;
  return `${range} of ${formatRowCount(total)}`;
}

export function resultSummary(result: QueryResult): string {
  return `${formatRowCount(result.row_count)} rows · ${result.elapsed_ms} ms`;
}

function markdownCell(value: unknown): string {
  return cellText(value).replace(/\|/g, "\\|").replace(/\r\n|\n|\r/g, "<br>");
}

export function formatMarkdownTable(columns: string[], rows: unknown[][]): string {
  const rowLine = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const lines = [rowLine(columns.map(markdownCell)), rowLine(columns.map(() => "---"))];
  for (const row of rows) {
    lines.push(rowLine(row.map(markdownCell)));
  }
  return `${lines.join("\n")}\n`;
}

export function exportBaseName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `query-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}
