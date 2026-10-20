import { lazy, Suspense, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { History, Loader2, Play, Plus, Wand2, X } from "lucide-react";
import { useDropdownPosition } from "../../components/ui/popover";
import { Button } from "../../components/ui/Button";
import { useDatabaseSchemaQuery } from "../../queries/databases";
import { pickRunText } from "./dbdisplay";
import { formatSql } from "./sqlEditor/format";
import { MAX_TABS, type SqlTab } from "./tabs";

const SqlCodeEditor = lazy(() => import("./sqlEditor/SqlCodeEditor"));

export function SqlConsole({
  serial,
  pkg,
  dbName,
  text,
  onTextChange,
  tabs,
  activeId,
  onSwitchTab,
  onCloseTab,
  onAddTab,
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
  tabs: SqlTab[];
  activeId: string;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  history: string[];
  running: boolean;
  onRun: (sql: string) => void;
  onClose: () => void;
}) {
  const schemaQuery = useDatabaseSchemaQuery(serial, pkg, dbName, true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const selectionRef = useRef<string>("");
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
            variant="ghost"
            size="icon"
            onClick={() => onTextChange(formatSql(text))}
            disabled={text.trim() === ""}
            title="Pretty-print the query"
            aria-label="Format SQL"
          >
            <Wand2 size={14} />
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onRun(pickRunText(text, selectionRef.current))}
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
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line/50 px-3 py-1">
        {tabs.map((tab, i) => {
          const active = tab.id === activeId;
          return (
            <span key={tab.id} className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => onSwitchTab(tab.id)}
                title={tab.sql}
                aria-current={active ? "true" : undefined}
                className={clsx(
                  "focus-ring rounded px-2 py-0.5 font-mono text-[11px] transition-colors",
                  active
                    ? "bg-surface-2 font-medium text-txt"
                    : "text-muted hover:bg-surface-2/60 hover:text-txt",
                )}
              >
                Q{i + 1}
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={() => onCloseTab(tab.id)}
                  title={`Close query ${i + 1}`}
                  aria-label={`Close query ${i + 1}`}
                  className="focus-ring -ml-1 rounded p-0.5 text-muted/70 transition-colors hover:text-txt"
                >
                  <X size={10} />
                </button>
              )}
            </span>
          );
        })}
        <button
          type="button"
          onClick={onAddTab}
          disabled={tabs.length >= MAX_TABS}
          title={tabs.length >= MAX_TABS ? `Up to ${MAX_TABS} queries` : "New query"}
          aria-label="New query"
          className="focus-ring shrink-0 rounded p-0.5 text-muted transition-colors hover:text-txt disabled:pointer-events-none disabled:opacity-40"
        >
          <Plus size={12} />
        </button>
      </div>
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
            selectionRef={selectionRef}
            schema={schemaQuery.data ?? []}
            placeholder='SELECT * FROM "table" LIMIT 50'
          />
        </Suspense>
      </div>
    </section>
  );
}
