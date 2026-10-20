const CLAUSE_STARTERS = [
  "LEFT OUTER JOIN",
  "RIGHT OUTER JOIN",
  "FULL OUTER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "INNER JOIN",
  "CROSS JOIN",
  "OUTER JOIN",
  "GROUP BY",
  "ORDER BY",
  "UNION ALL",
  "SELECT",
  "FROM",
  "WHERE",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "UNION",
  "VALUES",
  "SET",
  "JOIN",
];

interface Token {
  text: string;
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let current = "";
  let i = 0;
  const flush = () => {
    if (current !== "") {
      tokens.push({ text: current });
      current = "";
    }
  };
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      flush();
      let literal = ch;
      i++;
      while (i < sql.length) {
        literal += sql[i];
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            literal += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      tokens.push({ text: literal });
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      flush();
      let comment = "";
      while (i < sql.length && sql[i] !== "\n") {
        comment += sql[i];
        i++;
      }
      tokens.push({ text: comment });
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      i++;
      continue;
    }
    if (ch === "," || ch === "(" || ch === ")") {
      flush();
      tokens.push({ text: ch });
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  flush();
  return tokens;
}

function matchStarter(tokens: Token[], index: number): string[] | null {
  for (const starter of CLAUSE_STARTERS) {
    const words = starter.split(" ");
    let matched = true;
    for (let w = 0; w < words.length; w++) {
      const token = tokens[index + w];
      if (token == null || !/^[A-Za-z]+$/.test(token.text)) {
        matched = false;
        break;
      }
      if (token.text.toUpperCase() !== words[w]) {
        matched = false;
        break;
      }
    }
    if (matched) return tokens.slice(index, index + words.length).map((t) => t.text);
  }
  return null;
}

const FUNCTION_NAMES = new Set([
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "TOTAL",
  "GROUP_CONCAT",
  "LENGTH",
  "UPPER",
  "LOWER",
  "COALESCE",
  "IFNULL",
  "NULLIF",
  "ABS",
  "ROUND",
  "CAST",
  "SUBSTR",
  "REPLACE",
  "TRIM",
  "DATE",
  "TIME",
  "DATETIME",
  "STRFTIME",
  "JULIANDAY",
  "UNIXEPOCH",
  "JSON",
  "JSON_EXTRACT",
  "RANDOM",
  "LAST_INSERT_ROWID",
  "TYPEOF",
  "INSTR",
  "HEX",
  "QUOTE",
  "LIKELIHOOD",
  "LIKELY",
  "UNLIKELY",
  "IIF",
]);

function isFunctionCallName(text: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text) && FUNCTION_NAMES.has(text.toUpperCase());
}

export function formatSql(sql: string): string {
  const trimmed = sql.trim();
  if (trimmed === "") return "";
  const tokens = tokenize(trimmed);
  const lines: string[] = [];
  let line = "";
  let lineIndent = "";
  let depth = 0;
  const flush = () => {
    if (line !== "") lines.push(lineIndent + line);
    line = "";
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (depth === 0) {
      const starter = matchStarter(tokens, i);
      if (starter != null) {
        flush();
        if (starter[0].toUpperCase() === "SELECT") {
          lines.push(starter.join(" "));
          lineIndent = "  ";
        } else {
          lineIndent = "";
          line = starter.join(" ");
        }
        i += starter.length - 1;
        continue;
      }
    }
    if (token.text === "(") depth++;
    else if (token.text === ")") depth = Math.max(0, depth - 1);
    if (token.text === ",") {
      line += ",";
      if (depth === 0) flush();
      continue;
    }
    if (token.text === "(") {
      const prev = i > 0 ? tokens[i - 1].text : "";
      line += line === "" || isFunctionCallName(prev) ? "(" : " (";
      continue;
    }
    if (token.text === ")") {
      line += ")";
      continue;
    }
    line += line === "" || line.endsWith("(") ? token.text : ` ${token.text}`;
  }
  flush();
  return lines.join("\n");
}
