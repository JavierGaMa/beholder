import type { LogLine } from "../../store/console-types";

export type TokenType = "key" | "string" | "number" | "literal" | "punct";

export interface Token {
  type: TokenType;
  text: string;
}

export type EnrichedMessage = { pretty: string; highlighted: Token[] } | { text: string };

const RN_JSON_TAGS = new Set([
  "ReactNativeJS",
  "ReactNative",
  "unknown:ReactNativeJS",
  "unknown:ReactNative",
]);

export function enrich(line: Pick<LogLine, "tag" | "message">): EnrichedMessage {
  if (!RN_JSON_TAGS.has(line.tag)) return { text: line.message };
  const trimmed = line.message.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { text: line.message };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { text: line.message };
  }
  if (parsed == null || typeof parsed !== "object") return { text: line.message };
  const pretty = JSON.stringify(parsed, null, 2);
  return { pretty, highlighted: tokenize(pretty) };
}

const TOKEN_RE = /("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|(\s+)|([{}[\],:])|(.)/g;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let pending = "";
  const re = new RegExp(TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let type: TokenType;
    let chunk = m[0];
    if (m[1] != null) {
      type = /^\s*:/.test(text.slice(re.lastIndex)) ? "key" : "string";
    } else if (m[2] != null) {
      type = "number";
    } else if (m[3] != null) {
      type = "literal";
    } else if (m[4] != null) {
      pending += chunk;
      continue;
    } else if (m[5] != null) {
      type = "punct";
    } else {
      type = "punct";
    }
    chunk = pending + chunk;
    pending = "";
    tokens.push({ type, text: chunk });
  }
  if (pending.length > 0 && tokens.length > 0) {
    tokens[tokens.length - 1].text += pending;
  }
  return tokens;
}
