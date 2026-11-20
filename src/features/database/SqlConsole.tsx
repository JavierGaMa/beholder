import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp, History, Loader2, Play, Plus, Wand2, X } from "lucide-react";
import { useDropdownPosition } from "../../components/ui/popover";
import { Button } from "../../components/ui/Button";
import { useDatabaseSchemaQuery } from "../../queries/databases";
import { pickRunText } from "./dbdisplay";
import { formatSql } from "./sqlEditor/format";
import { MAX_TABS, tabLabel, type SqlTab } from "./tabs";

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
  editorOpen,
  onToggleEditor,
  editorHeight,
  resizer,
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
  editorOpen: boolean;
  onToggleEditor: () => void;
  editorHeight: number;
  resizer: ReactNode;
}) {
  const schemaQuery = useDatabaseSchemaQuery(serial, pkg, dbName, true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const selectionRef = useRef<string>("");
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
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

  function onTablistKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const index = tabs.findIndex((t) => t.id === activeId);
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next == null) return;
    onSwitchTab(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 px-2.5 py-2">
        <div
          role="tablist"
          aria-label="SQL queries"
          onKeyDown={onTablistKeyDown}
          className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-[var(--radius-md)] bg-surface-2 p-0.5"
        >
          {tabs.map((tab, i) => {
            const active = tab.id === activeId;
            const empty = tab.sql.trim() === "";
            return (
              <span
                key={tab.id}
                className={clsx(
                  "group flex h-6 shrink-0 items-center rounded-[var(--radius-sm)] transition-colors [transition-duration:var(--dur-base)]",
                  active ? "bg-surface shadow-[var(--shadow-1)]" : "hover:bg-surface/50",
                )}
              >
                <button
                  ref={(el) => {
                    if (el != null) tabRefs.current.set(tab.id, el);
                    else tabRefs.current.delete(tab.id);
                  }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onSwitchTab(tab.id)}
                  title={empty ? "Empty query" : tab.sql}
                  className={clsx(
                    "focus-ring flex h-6 items-center rounded-[var(--radius-sm)] px-2.5 text-[11px] font-medium",
                    active ? "text-txt" : "text-muted hover:text-txt",
                  )}
                >
                  <span className="max-w-[200px] truncate">{tabLabel(tab.sql, i)}</span>
                </button>
                {tabs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onCloseTab(tab.id)}
                    title={`Close query ${i + 1}`}
                    aria-label={`Close query ${i + 1}`}
                    className={clsx(
                      "focus-ring -ml-1 mr-0.5 grid h-5 w-5 place-items-center rounded-[var(--radius-sm)] text-muted transition-opacity hover:text-txt focus-visible:opacity-100",
                      active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <X size={11} />
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
            className="focus-ring grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-sm)] text-muted transition-colors hover:text-txt disabled:pointer-events-none disabled:opacity-40"
          >
            <Plus size={13} />
          </button>
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
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
                    className="focus-ring rounded px-2 py-1.5 text-left font-mono text-[11px] text-txt/90 transition-colors hover:bg-surface hover:text-txt"
                  >
                    <span className="line-clamp-2 break-all">{q}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onTextChange(formatSql(text))}
            disabled={text.trim() === ""}
            title="Pretty-print the query"
            aria-label="Format SQL"
          >
            <Wand2 size={14} /> Format
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onRun(pickRunText(text, selectionRef.current))}
            disabled={running || text.trim() === ""}
            title="Run query (Cmd/Ctrl+Enter)"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run{" "}
            <span className="font-mono">⌘↵</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleEditor}
            aria-pressed={editorOpen}
            title={editorOpen ? "Hide the SQL editor" : "Show the SQL editor"}
            aria-label={editorOpen ? "Hide SQL editor" : "Show SQL editor"}
          >
            {editorOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        </span>
      </header>
      {editorOpen && (
        <section
          className="flex shrink-0 flex-col border-y border-line/60"
          style={{ height: editorHeight }}
        >
          <div role="tabpanel" aria-label="SQL editor" className="min-h-0 flex-1">
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
          {resizer}
        </section>
      )}
    </>
  );
}
