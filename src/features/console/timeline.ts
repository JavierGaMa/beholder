import { isLogLine, type ConsoleEntry, type LogLine } from "../../store/console-types";
import type { HttpExchange } from "../../store/types";

export type TimelineItem =
  | { kind: "log"; at: number; line: LogLine }
  | { kind: "gap"; dropped: number; at: number }
  | { kind: "exchange"; at: number; exchange: HttpExchange };

const KIND_RANK: Record<TimelineItem["kind"], number> = { log: 0, gap: 1, exchange: 2 };

export function buildTimeline(
  entries: ConsoleEntry[],
  exchanges: Map<number, HttpExchange>,
  order: number[],
  skewMs: number,
): TimelineItem[] {
  const logs: TimelineItem[] = [];
  let lastAt: number | null = null;
  for (const entry of entries) {
    if (isLogLine(entry)) {
      lastAt = entry.ts_ms + skewMs;
      logs.push({ kind: "log", at: lastAt, line: entry });
    } else {
      logs.push({ kind: "gap", dropped: entry.dropped, at: lastAt ?? 0 });
    }
  }
  const exchangeItems: TimelineItem[] = [];
  for (const id of order) {
    const exchange = exchanges.get(id);
    if (!exchange) continue;
    exchangeItems.push({ kind: "exchange", at: exchange.request.started_at, exchange });
  }
  exchangeItems.sort((a, b) => a.at - b.at);
  const out: TimelineItem[] = [];
  let i = 0;
  let j = 0;
  while (i < logs.length && j < exchangeItems.length) {
    const l = logs[i];
    const e = exchangeItems[j];
    if (l.at < e.at || (l.at === e.at && KIND_RANK[l.kind] <= KIND_RANK[e.kind])) {
      out.push(l);
      i += 1;
    } else {
      out.push(e);
      j += 1;
    }
  }
  while (i < logs.length) {
    out.push(logs[i]);
    i += 1;
  }
  while (j < exchangeItems.length) {
    out.push(exchangeItems[j]);
    j += 1;
  }
  return out;
}
