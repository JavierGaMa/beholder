import { isLogLine, type ConsoleEntry, type LogLine, type LogLevel } from "../../store/console-types";

export interface LineRow {
  kind: "line";
  line: LogLine;
  repeatCount: number;
}

export interface GapRow {
  kind: "gap";
  dropped: number;
}

export type Row = LineRow | GapRow;

export const LEVEL_RANK: Record<LogLevel, number> = {
  Verbose: 0,
  Debug: 1,
  Info: 2,
  Warn: 3,
  Error: 4,
  Fatal: 5,
};

export interface EntryFilter {
  pid: number | null;
  tag: string | null;
  minLevel: LogLevel | null;
}

export function filterEntries(
  entries: ConsoleEntry[],
  filter: EntryFilter,
  regex: RegExp | null,
): ConsoleEntry[] {
  const tag = filter.tag?.trim().toLowerCase() || null;
  return entries.filter((e) => {
    if (!isLogLine(e)) return true;
    if (filter.pid != null && e.pid !== filter.pid) return false;
    if (tag != null) {
      const t = e.tag.toLowerCase();
      if (t !== tag && t !== `unknown:${tag}`) return false;
    }
    if (filter.minLevel != null && LEVEL_RANK[e.level] < LEVEL_RANK[filter.minLevel]) return false;
    if (regex != null && !regex.test(e.message)) return false;
    return true;
  });
}

export function buildRows(entries: ConsoleEntry[], opts: { collapse?: boolean } = {}): Row[] {
  const collapse = opts.collapse ?? true;
  const rows: Row[] = [];
  for (const entry of entries) {
    if (!isLogLine(entry)) {
      rows.push({ kind: "gap", dropped: entry.dropped });
      continue;
    }
    const prev = rows[rows.length - 1];
    if (
      collapse &&
      prev != null &&
      prev.kind === "line" &&
      prev.line.tag === entry.tag &&
      prev.line.message === entry.message
    ) {
      prev.repeatCount += entry.repeat_count;
      continue;
    }
    rows.push({ kind: "line", line: entry, repeatCount: entry.repeat_count });
  }
  return rows;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function timeOf(tsMs: number): string {
  const d = new Date(tsMs);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatLogLine(line: LogLine): string {
  return `[${timeOf(line.ts_ms)}] ${line.level}/${line.tag}(${line.pid}): ${line.message}`;
}

export interface LineStats {
  crashes: number;
  errors: number;
  warns: number;
}

export function computeLineStats(entries: ConsoleEntry[]): LineStats {
  let crashes = 0;
  let errors = 0;
  let warns = 0;
  for (const entry of entries) {
    if (!isLogLine(entry)) continue;
    if (entry.is_crash) crashes += 1;
    if (entry.level === "Error" || entry.level === "Fatal") errors += 1;
    else if (entry.level === "Warn") warns += 1;
  }
  return { crashes, errors, warns };
}

export function buildExportText(rows: Row[]): string {
  const out: string[] = [];
  for (const row of rows) {
    if (row.kind === "gap") {
      out.push(`--- gap: ${row.dropped} lines dropped ---`);
      continue;
    }
    out.push(formatLogLine(row.line));
  }
  return out.join("\n");
}
