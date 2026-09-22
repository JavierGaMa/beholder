import { useEffect, useMemo, useRef, useState } from "react";
import { History, Loader2, Play, X } from "lucide-react";
import { qError } from "../../lib/query";
import { EmptyState } from "../../components/ui/primitives";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { useDropdownPosition } from "../../components/ui/popover";
import { useRunDbQuery, type QueryResult } from "../../queries/databases";
import { TableGrid } from "./TableGrid";
import { formatRowCount, queryResultToPage } from "./dbdisplay";

export function SqlConsole({
  serial,
  pkg,
  dbName,
  table,
  text,
  onTextChange,
  history,
  onRan,
  onClose,
}: {
  serial: string;
  pkg: string;
  dbName: string;
  table: string | null;
  text: string;
  onTextChange: (next: string) => void;
  history: string[];
  onRan: (sql: string) => void;
  onClose: () => void;
}) {
  const run = useRunDbQuery();
  const [result, setResult] = useState<QueryResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { anchorRef, menuRef, style } = useDropdownPosition(historyOpen, {
    width: 420,
    estHeight: 220,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const gridPage = useMemo(
    () => (result == null ? null : queryResultToPage(result)),
    [result],
  );
  const error = qError(run.error);

  useEffect(() => {
    if (!historyOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setHistoryOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [historyOpen]);

  async function onRun() {
    const sql = text.trim();
    if (sql === "" || run.isPending) return;
    try {
      const res = await run.mutateAsync({ serial, pkg, dbName, sql });
      setResult(res);
      onRan(sql);
    } catch {
      setResult(null);
    }
  }

  return (
    <section className="flex h-[40%] min-h-52 shrink-0 flex-col border-b border-line bg-bg">
      <header className="flex shrink-0 items-center gap-2 border-b border-line/50 bg-surface px-3 py-1">
        <span className="text-[10px] uppercase tracking-wider text-muted/70">
          sql · <span className="font-mono lowercase">{dbName}</span>
          {table != null && (
            <>
              {" "}
              · <span className="font-mono lowercase">{table}</span>
            </>
          )}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <div ref={wrapRef} className="relative">
            <button
              ref={anchorRef}
              type="button"
              onClick={() => setHistoryOpen((o) => !o)}
              disabled={history.length === 0}
              title="Recent successful queries"
              className="flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-muted hover:text-txt disabled:opacity-40"
            >
              <History size={11} /> History
            </button>
            {historyOpen && (
              <div
                ref={menuRef}
                style={style}
                className="z-20 flex flex-col overflow-y-auto overscroll-contain rounded-md border border-line bg-surface-2 p-1.5 shadow-xl"
              >
                {history.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => {
                      onTextChange(q);
                      setHistoryOpen(false);
                    }}
                    title={q}
                    className="rounded px-2 py-1.5 text-left font-mono text-[11px] text-txt/90 hover:bg-surface-2 hover:text-txt"
                  >
                    <span className="line-clamp-2 break-all">{q}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void onRun()}
            disabled={run.isPending || text.trim() === ""}
            title="Run query (Cmd/Ctrl+Enter)"
            className="flex h-6 items-center gap-1 rounded-md border border-line bg-bg px-2 text-[11px] font-medium text-txt hover:bg-surface-2 disabled:opacity-40"
          >
            {run.isPending ? (
              <Loader2 size={11} className="animate-spin text-accent" />
            ) : (
              <Play size={11} />
            )}{" "}
            Run
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close the SQL console"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-line text-muted hover:text-txt"
          >
            <X size={11} />
          </button>
        </span>
      </header>
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void onRun();
          } else if (e.key === "Escape") {
            e.currentTarget.blur();
          }
        }}
        rows={3}
        spellCheck={false}
        placeholder='SELECT * FROM "table" LIMIT 50'
        className="shrink-0 resize-none border-b border-line bg-bg px-3 py-2 font-mono text-[12px] leading-relaxed text-txt placeholder:text-muted/50 focus:outline-none"
      />
      <div className="min-h-0 flex-1">
        {error != null ? (
          <div className="p-3">
            <ErrorBox message={error} />
          </div>
        ) : run.isPending ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 size={16} className="animate-spin text-accent" />
          </div>
        ) : gridPage == null ? (
          <EmptyState
            title="Run a SELECT query"
            hint="Read-only, against the local snapshot · Cmd/Ctrl+Enter runs"
          />
        ) : gridPage.rows.length === 0 ? (
          <EmptyState title="No rows" hint="The query ran successfully and returned nothing" />
        ) : (
          <TableGrid page={gridPage} offsetBase={0} />
        )}
      </div>
      {result != null && error == null && (
        <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-3 py-1 text-[11px] text-muted">
          <span className="font-mono">{formatRowCount(result.row_count)} rows</span>
          {result.truncated && (
            <span className="text-warn/80">showing first 500 of more than 500 rows</span>
          )}
          <span className="ml-auto font-mono text-[10px] text-muted/70">
            {result.elapsed_ms} ms
          </span>
        </footer>
      )}
    </section>
  );
}
