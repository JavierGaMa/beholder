import { completeFromList, type Completion } from "@codemirror/autocomplete";
import type { TableSchema } from "../../../queries/databases";
import { SQL_SNIPPETS } from "./snippets";

export function buildSqlSchema(schema: TableSchema[]): Record<string, string[]> {
  const byTable = new Map<string, Set<string>>();
  for (const table of schema) {
    const columns = byTable.get(table.name) ?? new Set<string>();
    for (const column of table.columns) columns.add(column.name);
    byTable.set(table.name, columns);
  }
  const result: Record<string, string[]> = {};
  for (const name of [...byTable.keys()].sort()) {
    result[name] = [...(byTable.get(name) ?? [])].sort();
  }
  return result;
}

export const SQL_KEYWORDS: string[] = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "CROSS",
  "ON",
  "GROUP",
  "BY",
  "ORDER",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "DROP",
  "ALTER",
  "INDEX",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS",
  "IN",
  "LIKE",
  "GLOB",
  "BETWEEN",
  "AS",
  "DISTINCT",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "UNION",
  "ALL",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "DEFAULT",
  "EXISTS",
  "CAST",
  "COLLATE",
  "PRAGMA",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "WITH",
];

const keywordCompletions: Completion[] = SQL_KEYWORDS.map((keyword) => ({
  label: keyword,
  type: "keyword",
}));

const snippetCompletions: Completion[] = SQL_SNIPPETS.map((snippet) => ({
  label: snippet.label,
  type: "text",
  detail: "snippet",
  apply: snippet.template,
}));

export const keywordSnippetSource: ReturnType<typeof completeFromList> = completeFromList([
  ...keywordCompletions,
  ...snippetCompletions,
]);
