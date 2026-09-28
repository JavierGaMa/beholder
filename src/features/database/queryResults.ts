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

export function formatTsv(columns: string[], rows: unknown[][]): string {
  const flatten = (field: string) => field.replace(/[\t\n\r]/g, " ");
  const lines = [columns.map(flatten).join("\t")];
  for (const row of rows) {
    lines.push(row.map((cell) => flatten(cellText(cell))).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

export function resultSummary(result: QueryResult): string {
  return `${formatRowCount(result.row_count)} rows · ${result.elapsed_ms} ms`;
}

export function csvFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `query-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.csv`;
}
