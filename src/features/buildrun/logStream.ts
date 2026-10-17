export interface LogPage {
  lines: string[];
  dropped: number;
}

export const MAX_LOG_LINES = 400;

export const EMPTY_LOG: LogPage = { lines: [], dropped: 0 };

export function appendLog(page: LogPage, line: string, cap: number = MAX_LOG_LINES): LogPage {
  if (page.lines.length < cap) {
    return { lines: [...page.lines, line], dropped: page.dropped };
  }
  const keep = page.lines.slice(page.lines.length - cap + 1);
  return { lines: [...keep, line], dropped: page.dropped + 1 };
}

export function logFootnote(page: LogPage): string {
  if (page.lines.length === 0) return "no output yet";
  const dropped = page.dropped > 0 ? ` · ${page.dropped} older dropped` : "";
  return `${page.lines.length} lines${dropped}`;
}
