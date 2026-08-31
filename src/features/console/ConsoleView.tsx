import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import {
  AlignLeft,
  Check,
  Eraser,
  FileDown,
  GripHorizontal,
  Pause,
  Play,
  Search,
  Smartphone,
  Square,
  Tag,
  Terminal,
  X,
} from "lucide-react";
import { useConsole } from "../../store/console";
import { useTraffic } from "../../store/traffic";
import { invoke, isTauri } from "../../lib/tauri";
import { EmptyState } from "../../components/ui/primitives";
import { toast } from "../../components/ui/toast";
import { isLogLine, type AppProcess, type ConsoleColumns, type LogLevel, type LogStatus, type PaneMode } from "../../store/console-types";
import { buildExportText, buildRows, computeLineStats, filterEntries } from "./rows";
import { resolveAppFilter } from "./appfilter";
import { LogRow } from "./LogRow";
import { CrashCard } from "./CrashCard";

const ShellPane = lazy(() => import("./ShellPane").then((m) => ({ default: m.ShellPane })));
const TimelineView = lazy(() => import("./TimelineView").then((m) => ({ default: m.TimelineView })));

const PANES: { id: PaneMode; label: string }[] = [
  { id: "logs", label: "Logs" },
  { id: "timeline", label: "Timeline" },
];

const SEVERITY: { level: LogLevel | null; label: string; cls: string }[] = [
  { level: null, label: "All", cls: "text-muted" },
  { level: "Info", label: "Info+", cls: "text-ok" },
  { level: "Warn", label: "Warn+", cls: "text-warn" },
  { level: "Error", label: "Error+", cls: "text-danger" },
];

const COLUMN_CHOICES: { key: keyof ConsoleColumns; label: string }[] = [
  { key: "time", label: "Time" },
  { key: "level", label: "Level" },
  { key: "tag", label: "Tag" },
  { key: "pid", label: "PID" },
  { key: "tid", label: "TID" },
];

const ALL_BUFFERS = ["main", "system", "crash"];
const BUFFER_CHOICES = ["all", "main", "system", "crash"];

function statusDotCls(status: LogStatus): string {
  if (status === "Streaming") return "bg-ok";
  if (status === "Disconnected") return "bg-warn";
  if (typeof status === "object") return "bg-danger";
  return "bg-muted";
}

function statusLabel(status: LogStatus): string {
  if (status === "Streaming") return "streaming";
  if (status === "Disconnected") return "disconnected, retrying";
  if (typeof status === "object") return status.Failed;
  return "stopped";
}

function statusWord(status: LogStatus): { text: string; cls: string } {
  if (status === "Streaming") return { text: "streaming", cls: "text-ok" };
  if (status === "Disconnected") return { text: "retrying", cls: "text-warn" };
  if (typeof status === "object") return { text: "failed", cls: "text-danger" };
  return { text: "stopped", cls: "text-muted/70" };
}

function shortPkg(pkg: string): string {
  const parts = pkg.split(".");
  return parts[parts.length - 1] || pkg;
}

export function ConsoleView() {
  const lines = useConsole((s) => s.lines);
  const status = useConsole((s) => s.status);
  const paused = useConsole((s) => s.paused);
  const pausedDropCount = useConsole((s) => s.pausedDropCount);
  const minLevel = useConsole((s) => s.minLevel);
  const tagQuery = useConsole((s) => s.tagQuery);
  const regex = useConsole((s) => s.regex);
  const regexError = useConsole((s) => s.regexError);
  const columns = useConsole((s) => s.columns);
  const observedTags = useConsole((s) => s.observedTags);
  const serial = useConsole((s) => s.serial);
  const running = useConsole((s) => s.running);
  const appFilter = useConsole((s) => s.appFilter);
  const paneMode = useConsole((s) => s.paneMode);
  const setPaneMode = useConsole((s) => s.setPaneMode);
  const shellOpen = useConsole((s) => s.shellOpen);
  const toggleShell = useConsole((s) => s.toggleShell);
  const setShellOpen = useConsole((s) => s.setShellOpen);
  const setPaused = useConsole((s) => s.setPaused);
  const clear = useConsole((s) => s.clear);
  const setMinLevel = useConsole((s) => s.setMinLevel);
  const setTagQuery = useConsole((s) => s.setTagQuery);
  const setRegex = useConsole((s) => s.setRegex);
  const setColumns = useConsole((s) => s.setColumns);
  const setAppFilter = useConsole((s) => s.setAppFilter);
  const start = useConsole((s) => s.start);
  const stop = useConsole((s) => s.stop);

  const targetSerial = useTraffic((s) => s.targetSerial);
  const uiConfig = useTraffic((s) => s.uiConfig);
  const configShowTid = uiConfig?.console?.show_tid ?? false;

  useEffect(() => {
    setColumns({ tid: configShowTid });
  }, [configShowTid, setColumns]);
  const configuredBuffer = uiConfig?.console?.default_buffer ?? "main";

  const [bufferChoice, setBufferChoice] = useState<string | null>(null);
  const buffer = bufferChoice ?? (BUFFER_CHOICES.includes(configuredBuffer) ? configuredBuffer : "all");

  const effectiveSerial = serial ?? targetSerial;
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [columnsMenuPos, setColumnsMenuPos] = useState<{ right: number; top: number } | null>(null);
  const columnsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [apps, setApps] = useState<AppProcess[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const appMissedRef = useRef(0);

  const onCopyLine = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast("Copied line"),
      () => {},
    );
  }, []);

  async function loadApps() {
    if (!effectiveSerial) return;
    setAppsLoading(true);
    try {
      setApps(await invoke<AppProcess[]>("console_apps", { serial: effectiveSerial }));
    } catch {
      setApps([]);
    } finally {
      setAppsLoading(false);
    }
  }

  function openAppMenu() {
    setAppMenuOpen(true);
    void loadApps();
  }

  function selectApp(app: AppProcess | null) {
    setAppMenuOpen(false);
    appMissedRef.current = 0;
    setAppFilter(app ? { package: app.package, pid: app.pid } : null);
  }

  useEffect(() => {
    if (!appFilter || !effectiveSerial) return;
    const id = setInterval(async () => {
      try {
        const list = await invoke<AppProcess[]>("console_apps", { serial: effectiveSerial });
        const outcome = resolveAppFilter(
          { package: appFilter.package, pid: appFilter.pid ?? 0, missed: appMissedRef.current },
          list,
        );
        appMissedRef.current = outcome.missed;
        if (outcome.action === "update") {
          setAppFilter({ package: appFilter.package, pid: outcome.pid });
          return;
        }
        if (outcome.action === "clear") {
          setAppFilter(null);
          toast("App process ended — filter cleared", "warn");
        }
      } catch {
        return;
      }
    }, 5000);
    return () => clearInterval(id);
  }, [appFilter, effectiveSerial, setAppFilter]);

  const regexRe = useMemo(() => {
    if (regex.length === 0 || regexError != null) return null;
    try {
      return new RegExp(regex);
    } catch {
      return null;
    }
  }, [regex, regexError]);

  const rows = useMemo(
    () =>
      buildRows(
        filterEntries(
          lines,
          { pid: appFilter?.pid ?? null, tag: tagQuery || null, minLevel },
          regexRe,
        ),
      ),
    [lines, appFilter, tagQuery, minLevel, regexRe],
  );

  const lineCount = useMemo(() => lines.reduce((n, e) => (isLogLine(e) ? n + 1 : n), 0), [lines]);
  const stats = useMemo(() => computeLineStats(lines), [lines]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 12,
  });

  const stick = useRef(true);
  const prevCount = useRef(0);

  function onScroll() {
    const el = parentRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  useEffect(() => {
    if (rows.length === prevCount.current) return;
    prevCount.current = rows.length;
    if (!stick.current) return;
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
    });
  }, [rows.length, virtualizer]);

  const splitRef = useRef<HTMLDivElement>(null);
  const [shellHeight, setShellHeight] = useState<number | null>(null);
  const shellDrag = useRef<{ startY: number; startH: number } | null>(null);

  function shellBaseHeight(): number {
    if (shellHeight != null) return shellHeight;
    return Math.floor((splitRef.current?.clientHeight ?? 480) * 0.4);
  }

  function onShellResizeStart(e: ReactPointerEvent<HTMLDivElement>) {
    shellDrag.current = { startY: e.clientY, startH: shellBaseHeight() };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onShellResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = shellDrag.current;
    if (!drag) return;
    const max = Math.max(120, Math.floor((splitRef.current?.clientHeight ?? 600) * 0.7));
    const next = drag.startH - (e.clientY - drag.startY);
    setShellHeight(Math.min(Math.max(next, 120), max));
  }

  function onShellResizeEnd() {
    shellDrag.current = null;
  }

  function buffersFor(choice: string): string[] {
    return choice === "all" ? ALL_BUFFERS : [choice];
  }

  function onStart() {
    if (!targetSerial) return;
    start(targetSerial, buffersFor(buffer));
  }

  function onBufferChange(choice: string) {
    setBufferChoice(choice);
    if (running && targetSerial) start(targetSerial, buffersFor(choice));
  }

  async function onClearBuffer() {
    clear();
    if (!effectiveSerial) return;
    try {
      await invoke("console_clear_buffer", { serial: effectiveSerial });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "danger");
    }
  }

  async function onExport() {
    const text = buildExportText(rows);
    const filename = `beholder-console-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    try {
      const path = await invoke<string | null>("console_export", { text, filename });
      if (path != null) toast(`Exported to ${path}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "danger");
    }
  }

  if (!isTauri || !targetSerial) {
    return <EmptyState title="Select an emulator target to stream logs" hint="Console streams adb logcat from the active target" />;
  }

  const word = statusWord(status);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
        <div className="flex h-7 items-center overflow-hidden rounded-md border border-line">
          {PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPaneMode(p.id)}
              className={clsx(
                "h-full px-2 font-mono text-[11px] transition-colors",
                paneMode === p.id ? "bg-surface-2 text-accent" : "text-muted hover:text-txt",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={clsx("size-2 shrink-0 rounded-full", statusDotCls(status))} />
          <span className={clsx("shrink-0 font-mono text-[11px] font-medium", word.cls)} title={statusLabel(status)}>
            {word.text}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-muted/70">·</span>
          <span className="truncate font-mono text-[11px] text-muted" title={statusLabel(status)}>
            {serial ?? targetSerial}
          </span>
        </span>
        <span className="font-mono text-[11px] text-muted">buffer</span>
        <select
          value={buffer}
          onChange={(e) => onBufferChange(e.target.value)}
          title="Logcat buffer"
          className="h-7 rounded-md border border-line bg-bg px-1.5 font-mono text-[11px] text-txt focus:border-accent focus:outline-none"
        >
          {BUFFER_CHOICES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          className={clsx(
            "flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] transition-colors",
            paused ? "border-accent text-accent" : "text-muted hover:text-txt",
          )}
        >
          {paused ? <Play size={11} /> : <Pause size={11} />}
          {paused ? "Resume" : "Pause"}
        </button>
        {running ? (
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-danger hover:border-danger"
          >
            <Square size={11} /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-fg"
          >
            <Play size={11} /> Start
          </button>
        )}
        <span className="h-4 w-px shrink-0 bg-line" />
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <div className="relative">
            <button
              type="button"
              onClick={() => (appMenuOpen ? setAppMenuOpen(false) : openAppMenu())}
              title={
                appFilter
                  ? `${appFilter.package}${appFilter.pid != null ? ` (${appFilter.pid})` : ""}`
                  : "Filter by app process"
              }
              className={clsx(
                "flex h-7 max-w-56 items-center gap-1.5 rounded-md border bg-bg px-1.5 font-mono text-[11px] focus:outline-none",
                appFilter ? "border-accent text-accent" : "border-line text-txt hover:border-accent",
              )}
            >
              <Smartphone size={11} className="shrink-0" />
              <span className="truncate">
                {appFilter
                  ? `${shortPkg(appFilter.package)}${appFilter.pid != null ? ` · ${appFilter.pid}` : ""}`
                  : "All apps"}
              </span>
            </button>
            {appMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setAppMenuOpen(false)} />
                <div className="absolute left-0 top-8 z-30 max-h-72 w-80 overflow-auto rounded-md border border-line bg-surface-2 p-1 shadow-xl">
                  {appsLoading ? (
                    <div className="px-2 py-1 font-mono text-[11px] text-muted">loading...</div>
                  ) : apps.length === 0 ? (
                    <div className="px-2 py-1 font-mono text-[11px] text-muted">no third-party apps found</div>
                  ) : (
                    <>
                      {appFilter != null && (
                        <button
                          type="button"
                          onClick={() => selectApp(null)}
                          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[11px] text-accent hover:bg-surface"
                        >
                          All apps
                        </button>
                      )}
                      {apps.map((a) => (
                        <button
                          key={a.package}
                          type="button"
                          disabled={a.pid == null}
                          title={a.pid == null ? `${a.package} is not running` : a.package}
                          onClick={() => selectApp(a)}
                          className={clsx(
                            "flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[11px] hover:bg-surface",
                            a.pid == null ? "cursor-not-allowed text-muted/50" : "text-txt",
                            appFilter?.package === a.package && "text-accent",
                          )}
                        >
                          <span className="shrink-0 font-medium">{shortPkg(a.package)}</span>
                          <span className="min-w-0 flex-1 truncate text-muted/70">{a.package}</span>
                          <span className="shrink-0 text-muted/70">{a.pid ?? "not running"}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex h-7 items-center overflow-hidden rounded-md border border-line">
            {SEVERITY.map((s, i) => (
              <button
                key={s.label}
                type="button"
                title={s.level == null ? "Show all log levels" : `Show ${s.level} and above`}
                onClick={() => setMinLevel(s.level)}
                className={clsx(
                  "h-full px-2 font-mono text-[11px] transition-colors",
                  i > 0 && "border-l border-line",
                  minLevel === s.level ? "bg-surface-2 font-semibold" : "hover:bg-surface",
                  s.cls,
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="relative">
            <Tag
              size={11}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted/70"
            />
            <input
              list="console-observed-tags"
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
              placeholder="filter by tag"
              title="Tag filter (server-side)"
              className="h-7 w-32 rounded-md border border-line bg-bg pl-6 pr-2 font-mono text-[11px] text-txt placeholder:text-muted/50 focus:border-accent focus:outline-none"
            />
          </span>
          <datalist id="console-observed-tags">
            {observedTags.slice(-200).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <span className="relative">
            <Search
              size={11}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted/70"
            />
            <input
              value={regex}
              onChange={(e) => setRegex(e.target.value)}
              placeholder="search message (regex)"
              title={regexError ?? "Regex search (client-side)"}
              className={clsx(
                "h-7 w-44 rounded-md border bg-bg pl-6 pr-2 font-mono text-[11px] text-txt placeholder:text-muted/50 focus:outline-none",
                regexError != null ? "border-danger text-danger" : "border-line focus:border-accent",
              )}
            />
          </span>
        </span>
        <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          <div className="relative">
            <button
              ref={columnsBtnRef}
              type="button"
              onClick={() => {
                if (columnsMenuOpen) {
                  setColumnsMenuOpen(false);
                  return;
                }
                const rect = columnsBtnRef.current?.getBoundingClientRect();
                if (!rect) return;
                const menuH = 168;
                const menuW = 152;
                const top =
                  rect.bottom + 4 + menuH > window.innerHeight
                    ? Math.max(8, rect.top - menuH - 4)
                    : rect.bottom + 4;
                const right = Math.min(
                  Math.max(8, window.innerWidth - rect.right),
                  window.innerWidth - menuW - 8,
                );
                setColumnsMenuPos({ right, top });
                setColumnsMenuOpen(true);
              }}
              aria-haspopup="menu"
              aria-expanded={columnsMenuOpen}
              title="Choose visible columns"
              className={clsx(
                "flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors",
                columns.time || columns.tag || columns.pid || columns.tid
                  ? "border-accent text-accent"
                  : "border-line text-muted hover:text-txt",
              )}
            >
              <AlignLeft size={11} /> Columns
            </button>
            {columnsMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setColumnsMenuOpen(false)} />
                <div
                  className="fixed z-40 w-36 rounded-md border border-line bg-surface-2 p-1 shadow-xl"
                  style={columnsMenuPos ?? undefined}
                >
                  {COLUMN_CHOICES.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setColumns({ [c.key]: !columns[c.key] } as Partial<ConsoleColumns>)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[11px] text-txt hover:bg-surface"
                    >
                      {columns[c.key] ? (
                        <Check size={11} className="shrink-0 text-accent" />
                      ) : (
                        <span className="w-[11px] shrink-0" />
                      )}
                      {c.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={toggleShell}
            aria-label="Toggle adb shell"
            title="adb shell (open a terminal on the device)"
            className={clsx(
              "flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors",
              shellOpen ? "border-accent text-accent" : "border-line text-muted hover:text-txt",
            )}
          >
            <Terminal size={11} /> Shell
          </button>
          <button
            type="button"
            onClick={onClearBuffer}
            title="Clear device logcat buffer and view"
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-muted hover:text-txt"
          >
            <Eraser size={11} /> Clear
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={rows.length === 0}
            title="Export visible rows to a text file"
            className={clsx(
              "flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] transition-colors",
              rows.length === 0
                ? "cursor-not-allowed text-muted/40"
                : "text-muted hover:text-txt",
            )}
          >
            <FileDown size={11} /> Export
          </button>
        </span>
      </div>
      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          {paneMode === "timeline" ? (
            <Suspense fallback={null}>
              <TimelineView />
            </Suspense>
          ) : (
            <div ref={parentRef} onScroll={onScroll} className="h-full overflow-auto">
              {rows.length === 0 ? (
                <EmptyState
                  title={running ? "No lines match the current filters" : "Console not streaming"}
                  hint={
                    running
                      ? "Adjust level, tag or regex filters"
                      : "Press Start to attach adb logcat to the target. Tip: filter by tag ReactNativeJS to see app logs"
                  }
                />
              ) : (
                <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                  {virtualizer.getVirtualItems().map((vi) => {
                    const row = rows[vi.index];
                    return (
                      <div
                        key={vi.key}
                        data-index={vi.index}
                        ref={virtualizer.measureElement}
                        className="absolute left-0 top-0 w-full"
                        style={{ transform: `translateY(${vi.start}px)` }}
                      >
                        {row.kind === "line" && row.line.is_crash ? (
                          <CrashCard line={row.line} repeatCount={row.repeatCount} onCopy={onCopyLine} />
                        ) : (
                          <LogRow row={row} cols={columns} onCopy={onCopyLine} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        {shellOpen && (
          <div className="flex shrink-0 flex-col" style={{ height: shellHeight ?? "40%" }}>
            <div
              onPointerDown={onShellResizeStart}
              onPointerMove={onShellResizeMove}
              onPointerUp={onShellResizeEnd}
              onPointerCancel={onShellResizeEnd}
              className="flex h-1.5 cursor-row-resize touch-none select-none items-center justify-center border-t border-line bg-surface"
            >
              <GripHorizontal size={11} className="text-muted/70" />
            </div>
            <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-surface px-2">
              <span className="truncate font-mono text-[11px] text-muted" title={`adb shell · ${effectiveSerial ?? targetSerial}`}>
                adb shell · {effectiveSerial ?? targetSerial}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setShellOpen(false)}
                aria-label="Close shell"
                title="Close shell"
                className="shrink-0 text-muted hover:text-txt"
              >
                <X size={11} />
              </button>
            </div>
            <div className="min-h-0 flex-1 bg-bg">
              <Suspense fallback={null}>
                <ShellPane serial={effectiveSerial ?? targetSerial} />
              </Suspense>
            </div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-line bg-surface px-3 py-1 text-[10px] uppercase tracking-wider text-muted/70">
        <span>
          {lineCount} lines ·{" "}
          <button
            type="button"
            title="Show Error and above"
            onClick={() => setMinLevel("Error")}
            className={clsx("hover:underline", stats.errors > 0 ? "text-danger" : "text-muted/50")}
          >
            {stats.errors} errors
          </button>{" "}
          ·{" "}
          <button
            type="button"
            title="Show Warn and above"
            onClick={() => setMinLevel("Warn")}
            className={clsx("hover:underline", stats.warns > 0 ? "text-warn" : "text-muted/50")}
          >
            {stats.warns} warns
          </button>
          {pausedDropCount > 0 ? ` · ${pausedDropCount} dropped` : ""}
          {paused && pausedDropCount === 0 ? " · paused" : ""}
        </span>
        <span>
          {rows.length} shown · {statusLabel(status)}
        </span>
      </div>
    </div>
  );
}
