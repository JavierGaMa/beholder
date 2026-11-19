export type JsonTokenKind = "key" | "string" | "number" | "boolean" | "null" | "punctuation";

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const PUNCTUATION = new Set(["{", "}", "[", "]", ",", ":"]);

export function tokenizeJson(source: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === '"') {
      const end = scanString(source, i);
      tokens.push({
        kind: followedByColon(source, end) ? "key" : "string",
        text: source.slice(i, end),
      });
      i = end;
    } else if (ch === "-" || isDigit(ch)) {
      const end = scanNumber(source, i);
      tokens.push({ kind: "number", text: source.slice(i, end) });
      i = end;
    } else if (source.startsWith("true", i) || source.startsWith("false", i)) {
      const literal = source.startsWith("true", i) ? "true" : "false";
      tokens.push({ kind: "boolean", text: literal });
      i += literal.length;
    } else if (source.startsWith("null", i)) {
      tokens.push({ kind: "null", text: "null" });
      i += 4;
    } else {
      const end = scanPunctuation(source, i);
      tokens.push({ kind: "punctuation", text: source.slice(i, end) });
      i = end;
    }
  }
  return tokens;
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isSpace(ch: string): boolean {
  return /\s/.test(ch);
}

function scanString(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    i += 1;
  }
  return source.length;
}

function followedByColon(source: string, from: number): boolean {
  let i = from;
  while (i < source.length && isSpace(source.charAt(i))) i += 1;
  return source.charAt(i) === ":";
}

function scanNumber(source: string, start: number): number {
  let i = start;
  if (source.charAt(i) === "-") i += 1;
  while (i < source.length && isDigit(source.charAt(i))) i += 1;
  if (source.charAt(i) === ".") {
    i += 1;
    while (i < source.length && isDigit(source.charAt(i))) i += 1;
  }
  const exponent = source.charAt(i);
  if (exponent === "e" || exponent === "E") {
    i += 1;
    const sign = source.charAt(i);
    if (sign === "+" || sign === "-") i += 1;
    while (i < source.length && isDigit(source.charAt(i))) i += 1;
  }
  return i;
}

function scanPunctuation(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (!isSpace(ch) && !PUNCTUATION.has(ch)) break;
    i += 1;
  }
  return i === start ? start + 1 : i;
}
