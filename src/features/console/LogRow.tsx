import { memo } from "react";
import clsx from "clsx";
import type { ConsoleColumns, LogLevel } from "../../store/console-types";
import { enrich, type TokenType } from "./logEnrich";
import { formatLogLine, timeOf, type Row } from "./rows";

export const LEVEL_LETTER: Record<LogLevel, string> = {
  Verbose: "V",
  Debug: "D",
  Info: "I",
  Warn: "W",
  Error: "E",
  Fatal: "F",
};

export function levelCls(level: LogLevel): string {
  switch (level) {
    case "Info":
      return "text-ok";
    case "Warn":
      return "text-warn";
    case "Error":
    case "Fatal":
      return "text-danger";
    default:
      return "text-muted";
  }
}

const TOKEN_CLS: Record<TokenType, string> = {
  key: "text-accent",
  string: "text-ok",
  number: "text-warn",
  literal: "text-danger",
  punct: "text-muted/70",
};

export const LogRow = memo(function LogRow({
  row,
  cols,
  onCopy,
}: {
  row: Row;
  cols: ConsoleColumns;
  onCopy?: (text: string) => void;
}) {
  if (row.kind === "gap") {
    return (
      <div className="flex items-center border-b border-line/40 bg-surface px-3 py-0.5 font-mono text-[11px] italic text-muted/70">
        ··· {row.dropped} lines dropped while paused ···
      </div>
    );
  }
  const { line, repeatCount } = row;
  const enriched = enrich(line);
  function handleClick() {
    if (!onCopy) return;
    if (window.getSelection()?.toString()) return;
    onCopy(formatLogLine(line));
  }
  const allCols = cols.time && cols.level && cols.tag && cols.pid && cols.tid;
  return (
    <div
      onClick={handleClick}
      title={allCols ? undefined : formatLogLine(line)}
      className={clsx(
        "flex cursor-default items-start gap-2 border-b border-line/40 px-3 py-0.5 font-mono text-[length:var(--mono-size,12px)] leading-5",
        line.is_crash ? "bg-danger/10" : "hover:bg-surface/60",
      )}
    >
      {cols.time && <span className="w-[86px] shrink-0 tabular-nums text-muted/80">{timeOf(line.ts_ms)}</span>}
      {cols.level && (
        <span className={clsx("w-3 shrink-0 text-center font-bold", levelCls(line.level))}>
          {LEVEL_LETTER[line.level]}
        </span>
      )}
      {cols.tag && (
        <span className="w-28 shrink-0 truncate text-accent" title={line.tag}>
          {line.tag}
        </span>
      )}
      {cols.pid && <span className="w-12 shrink-0 text-right tabular-nums text-muted/70">{line.pid}</span>}
      {cols.tid && <span className="w-12 shrink-0 text-right tabular-nums text-muted/50">{line.tid}</span>}
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-txt/90">
        {"pretty" in enriched ? (
          <>
            {enriched.highlighted.map((t, i) => (
              <span key={i} className={TOKEN_CLS[t.type]}>
                {t.text}
              </span>
            ))}
          </>
        ) : (
          enriched.text
        )}
        {repeatCount > 1 && (
          <span className="ml-2 rounded border border-line px-1 text-[10px] leading-4 text-muted">
            × {repeatCount}
          </span>
        )}
      </span>
    </div>
  );
});
