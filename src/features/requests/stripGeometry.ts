import type { HttpExchange } from "../../store/types";

export const MIN_WINDOW_S = 12;
export const MAX_WINDOW_S = 60;
const STEP_S = 4;
const MIN_TICK = 0.14;

export interface TimeWindow {
  start: number;
  end: number;
  seconds: number;
}

export type Severity = "normal" | "warn" | "danger";

export function exchangeEnd(ex: HttpExchange): number {
  return ex.request.started_at + (ex.timing.total_ms ?? 0);
}

export function timeWindow(rows: HttpExchange[]): TimeWindow {
  if (rows.length === 0) return { start: -MIN_WINDOW_S * 1000, end: 0, seconds: MIN_WINDOW_S };
  let end = -Infinity;
  let earliest = Infinity;
  for (const ex of rows) {
    end = Math.max(end, exchangeEnd(ex));
    earliest = Math.min(earliest, ex.request.started_at);
  }
  const raw = (end - earliest) / 1000;
  const seconds = Math.min(MAX_WINDOW_S, Math.max(MIN_WINDOW_S, Math.ceil(raw / STEP_S) * STEP_S));
  return { start: end - seconds * 1000, end, seconds };
}

export function xFraction(t: number, w: TimeWindow): number {
  const span = w.end - w.start;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (t - w.start) / span));
}

export function inWindow(ex: HttpExchange, w: TimeWindow): boolean {
  return ex.request.started_at >= w.start && ex.request.started_at <= w.end;
}

export function severity(ex: HttpExchange): Severity {
  const status = ex.response?.status ?? null;
  if (ex.error != null || (status != null && status >= 500)) return "danger";
  if (status != null && status >= 400) return "warn";
  return "normal";
}

export function tickHeight(ex: HttpExchange): number {
  if (severity(ex) === "danger") return 1;
  const total = ex.timing.total_ms;
  if (total == null) return MIN_TICK;
  const scaled = MIN_TICK + (Math.log10(Math.max(total, 1)) / 3.3) * (1 - MIN_TICK);
  return Math.min(1, Math.max(MIN_TICK, scaled));
}

const TICK_CLASS: Record<Severity, string> = {
  normal: "bg-muted opacity-45",
  warn: "bg-warn opacity-95",
  danger: "bg-danger opacity-95",
};

export function tickClass(s: Severity): string {
  return TICK_CLASS[s];
}

export function waterfallBar(ex: HttpExchange, w: TimeWindow): { left: number; width: number } | null {
  const end = exchangeEnd(ex);
  if (end < w.start) return null;
  const left = xFraction(Math.max(ex.request.started_at, w.start), w);
  const right = xFraction(end, w);
  return { left, width: Math.max(0, right - left) };
}

export function axisLabels(w: TimeWindow): string[] {
  return [0, 1, 2, 3, 4].map((i) => {
    const s = (w.seconds * i) / 4;
    return `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
  });
}
