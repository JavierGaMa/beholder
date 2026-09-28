const WRITE_KEYWORDS = new Set([
  "insert",
  "update",
  "delete",
  "create",
  "drop",
  "alter",
  "replace",
  "truncate",
]);

function stripStatementPrefix(sql: string): string {
  let rest = sql;
  for (;;) {
    const trimmed = rest.replace(/^[\s;]+/, "");
    if (trimmed.startsWith("--")) {
      const newline = trimmed.indexOf("\n");
      if (newline === -1) return "";
      rest = trimmed.slice(newline + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      if (end === -1) return "";
      rest = trimmed.slice(end + 2);
      continue;
    }
    return trimmed;
  }
}

export function isWriteStatement(sql: string): boolean {
  const first = stripStatementPrefix(sql).split(/[\s(]+/, 1)[0] ?? "";
  return WRITE_KEYWORDS.has(first.toLowerCase());
}

export interface PendingWrite {
  sql: string;
  changes: number;
  at: number;
}

export function appendPending(list: PendingWrite[], entry: PendingWrite): PendingWrite[] {
  return [...list, entry];
}

export function clearPending(): PendingWrite[] {
  return [];
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function cellLiteral(value: number | string | null): string {
  if (value == null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

export function cellValueFromInput(text: string, original: unknown): number | string | null {
  if (text === "") return null;
  if (typeof original === "number") {
    const parsed = Number(text.trim());
    if (text.trim() !== "" && Number.isFinite(parsed)) return parsed;
  }
  return text;
}

export function cellUpdateSql(
  table: string,
  col: string,
  value: number | string | null,
  rowid: number,
): string {
  return `UPDATE ${quoteIdent(table)} SET ${quoteIdent(col)} = ${cellLiteral(value)} WHERE rowid = ${rowid}`;
}

export function deleteRowSql(table: string, rowid: number): string {
  return `DELETE FROM ${quoteIdent(table)} WHERE rowid = ${rowid}`;
}
