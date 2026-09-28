export interface SqlSnippet {
  label: string;
  template: string;
}

export const SQL_SNIPPETS: SqlSnippet[] = [
  {
    label: "select star",
    template: "SELECT * FROM {table} LIMIT 50",
  },
  {
    label: "select where",
    template: "SELECT * FROM {table} WHERE <condition>",
  },
  {
    label: "order by",
    template: "SELECT * FROM {table} ORDER BY <column> DESC",
  },
  {
    label: "limit",
    template: "SELECT * FROM {table} LIMIT <n>",
  },
  {
    label: "count",
    template: "SELECT COUNT(*) FROM {table}",
  },
  {
    label: "join",
    template: "SELECT * FROM {table} JOIN other ON {table}.<id> = other.<id>",
  },
  {
    label: "insert into",
    template: "INSERT INTO {table} (<columns>) VALUES (<values>)",
  },
  {
    label: "update where",
    template: "UPDATE {table} SET <column> = <value> WHERE <condition>",
  },
];

export function applySnippet(template: string, table?: string): string {
  if (table == null) return template;
  const ident = `"${table.replace(/"/g, '""')}"`;
  return template.replace(/\{table\}/g, ident);
}
