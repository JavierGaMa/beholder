import type { WsFrame } from "../../store/traffic";

export type DirectionFilter = "all" | "sent" | "received";

export interface FrameCounts {
  all: number;
  sent: number;
  received: number;
}

export type FormattedPayload =
  | { kind: "json"; text: string }
  | { kind: "text"; text: string }
  | { kind: "binary"; text: string };

export type JsonTokenKind = "key" | "string" | "number" | "literal" | "punct";

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

function matchesQuery(frame: WsFrame, needle: string): boolean {
  return needle === "" || frame.payload.text.toLowerCase().includes(needle);
}

function matchesDirection(frame: WsFrame, direction: DirectionFilter): boolean {
  if (direction === "all") return true;
  return direction === "sent" ? frame.direction === "Sent" : frame.direction === "Received";
}

export function filterFrames(frames: WsFrame[], query: string, direction: DirectionFilter): WsFrame[] {
  const needle = query.trim().toLowerCase();
  if (needle === "" && direction === "all") return frames;
  return frames.filter((f) => matchesQuery(f, needle) && matchesDirection(f, direction));
}

export function frameCounts(frames: WsFrame[], query: string): FrameCounts {
  const needle = query.trim().toLowerCase();
  const counts: FrameCounts = { all: 0, sent: 0, received: 0 };
  for (const frame of frames) {
    if (!matchesQuery(frame, needle)) continue;
    counts.all++;
    if (frame.direction === "Sent") counts.sent++;
    else counts.received++;
  }
  return counts;
}

export function formatPayload(payload: WsFrame["payload"]): FormattedPayload {
  if (payload.is_binary) return { kind: "binary", text: `(${payload.size} bytes binary)` };
  const trimmed = payload.text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { kind: "json", text: JSON.stringify(JSON.parse(trimmed), null, 2) };
    } catch {
      return { kind: "text", text: payload.text };
    }
  }
  return { kind: "text", text: payload.text };
}

const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

export function highlightJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: "punct", text: text.slice(last, index) });
    if (match[1] != null) {
      tokens.push({ kind: match[2] != null ? "key" : "string", text: match[1] });
      if (match[2] != null) tokens.push({ kind: "punct", text: match[2] });
    } else if (match[3] != null) {
      tokens.push({ kind: "number", text: match[3] });
    } else {
      tokens.push({ kind: "literal", text: match[4] });
    }
    last = index + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: "punct", text: text.slice(last) });
  return tokens;
}

export function connectionParts(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url);
    if (parsed.host === "") return { host: url, path: "" };
    return { host: parsed.host, path: `${parsed.pathname}${parsed.search}` };
  } catch {
    return { host: url, path: "" };
  }
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}
