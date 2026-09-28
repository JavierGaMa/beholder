import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { History, Loader2, Play, X } from "lucide-react";
import { useDropdownPosition } from "../../components/ui/popover";
import { useDatabaseSchemaQuery } from "../../queries/databases";

const SqlCodeEditor = lazy(() => import("./sqlEditor/SqlCodeEditor"));

export function SqlConsole({
  serial,
  pkg,
  dbName,
  text,
  onTextChange,
  history,
  running,
  onRun,
  onClose,
}: {
  serial: string;
  pkg: string;
  dbName: string;
  text: string;
  onTextChange: (next: string) => void;
  history: string[];
  running: boolean;
  onRun: () => void;
  onClose: () => void;
}) {
  const schemaQuery = useDatabaseSchemaQuery(serial, pkg, dbName, true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { anchorRef, menuRef, style } = useDropdownPosition(historyOpen, {
    width: 420,
    estHeight: 220,
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!historyOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setHistoryOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [historyOpen]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line/50 px-3 py-1">
        <span className="text-[10px] uppercase tracking-wider text-muted/70">
          sql · <span className="font-mono lowercase">{dbName}</span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <div ref={wrapRef} className="relative">
            <button
              ref={anchorRef}
              type="button"
              onClick={() => setHistoryOpen((o) => !o)}
              disabled={history.length === 0}
              title="Recent successful queries"
              className="flex h-7 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-muted hover:text-txt disabled:opacity-40"
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
            onClick={onRun}
            disabled={running || text.trim() === ""}
            title="Run query (Cmd/Ctrl+Enter)"
            className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11px] font-medium text-accent-fg disabled:opacity-40"
          >
            {running ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Play size={11} />
            )}{" "}
            Run ⌘↵
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close the SQL console"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-muted hover:text-txt"
          >
            <X size={11} />
          </button>
        </span>
      </header>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 size={14} className="animate-spin text-accent" />
            </div>
          }
        >
          <SqlCodeEditor
            value={text}
            onChange={onTextChange}
            onRun={onRun}
            schema={schemaQuery.data ?? []}
            placeholder='SELECT * FROM "table" LIMIT 50'
          />
        </Suspense>
      </div>
    </section>
  );
}
