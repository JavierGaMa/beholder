import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { History, Loader2, Play, X } from "lucide-react";
import { useDropdownPosition } from "../../components/ui/popover";
import { Button } from "../../components/ui/Button";
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
            <Button
              ref={anchorRef}
              variant="ghost"
              size="sm"
              onClick={() => setHistoryOpen((o) => !o)}
              disabled={history.length === 0}
              title="Recent successful queries"
            >
              <History size={14} /> History
            </Button>
            {historyOpen && (
              <div
                ref={menuRef}
                style={style}
                className="anim-pop-in z-20 flex flex-col overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-line bg-surface-2 p-1.5 shadow-[var(--shadow-3)]"
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
                    className="focus-ring rounded px-2 py-1.5 text-left font-mono text-[11px] text-txt/90 transition-colors hover:bg-surface-2 hover:text-txt"
                  >
                    <span className="line-clamp-2 break-all">{q}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={onRun}
            disabled={running || text.trim() === ""}
            title="Run query (Cmd/Ctrl+Enter)"
          >
            {running ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}{" "}
            Run ⌘↵
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            title="Close the SQL console"
            aria-label="Close SQL console"
          >
            <X size={14} />
          </Button>
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
