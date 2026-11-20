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
  ChevronDown,
  Eraser,
  FileDown,
  GripHorizontal,
  Layers,
  Pause,
  Play,
  Smartphone,
  Square,
  Terminal,
} from "lucide-react";
import { useConsole } from "../../store/console";
import { useTraffic } from "../../store/traffic";
import { invoke, isTauri } from "../../lib/tauri";
import { EmptyState } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { Menu, type MenuOption } from "../../components/ui/Menu";
import { useDropdownPosition } from "../../components/ui/popover";
import { toast } from "../../components/ui/toast";
import { isLogLine, type AppProcess, type ConsoleColumns, type LogStatus, type PaneMode } from "../../store/console-types";
import { buildExportText, buildRows, computeLineStats, filterEntries } from "./rows";
import { resolveAppFilter, syncFocusApp } from "./appfilter";
import { LogRow } from "./LogRow";
import { CrashCard } from "./CrashCard";
import { severityOptions, showLogFilters, streamPill, type PillTone } from "./toolbar";

const ShellPane = lazy(() => import("./ShellPane").then((m) => ({ default: m.ShellPane })));
const TimelineView = lazy(() => import("./TimelineView").then((m) => ({ default: m.TimelineView })));

const PANES: { value: PaneMode; label: string }[] = [
  { value: "logs", label: "Logs" },
  { value: "timeline", label: "Timeline" },
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

function statusLabel(status: LogStatus): string {
  if (status === "Streaming") return "streaming";
  if (status === "Disconnected") return "disconnected, retrying";
  if (typeof status === "object") return status.Failed;
  return "stopped";
}

const PILL_TONE: Record<PillTone, string> = {
  accent: "bg-accent/12 text-accent",
  warn: "bg-warn/12 text-warn",
  danger: "bg-danger/12 text-danger",
  muted: "bg-surface-2 text-muted",
};

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
  const appMenuPos = useDropdownPosition(appMenuOpen, { width: 320, estHeight: 288 });
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
    syncFocusApp(app ? app.package : null);
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
    estimateSize: () => 30,
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
    return (
      <div className="panel h-full">
        <EmptyState title="Select an emulator target to stream logs" hint="Console streams adb logcat from the active target" />
      </div>
    );
  }

  const pill = streamPill(status);
  const filtersVisible = showLogFilters(paneMode);
  const severity = severityOptions(lineCount, stats);
  const deviceSerial = effectiveSerial ?? targetSerial;

  const columnItems: MenuOption[] = COLUMN_CHOICES.map((c) => ({
    key: c.key,
    label: c.label,
    icon: columns[c.key] ? Check : undefined,
    onSelect: () => setColumns({ [c.key]: !columns[c.key] } as Partial<ConsoleColumns>),
  }));

  const bufferItems: MenuOption[] = BUFFER_CHOICES.map((b) => ({
    key: b,
    label: b,
    icon: buffer === b ? Check : undefined,
    onSelect: () => onBufferChange(b),
  }));

  return (
    <div ref={splitRef} className="@container/console flex h-full min-h-0 flex-col">
      <section className="panel flex min-h-0 flex-1 flex-col">
        <div className="flex h-12 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-line px-3">
          <SegmentedControl
            options={PANES}
            value={paneMode}
            onChange={setPaneMode}
            ariaLabel="Console pane"
            className="shrink-0"
          />
          <div
            title={`${statusLabel(status)} · ${deviceSerial}`}
            className={clsx(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-full pl-2.5 pr-0.5 text-[12px] font-medium",
              PILL_TONE[pill.tone],
            )}
          >
            <span
              className={clsx(
                "size-1.5 shrink-0 rounded-full bg-current",
                pill.pulse && "animate-pulse motion-reduce:animate-none",
              )}
            />
            <span>{pill.text}</span>
            <button
              type="button"
              onClick={() => setPaused(!paused)}
              aria-pressed={paused}
              title={paused ? "Resume rendering new lines" : "Pause rendering new lines"}
              className={clsx(
                "focus-ring ml-0.5 flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors [transition-duration:var(--dur-fast)]",
                paused ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface hover:text-txt",
              )}
            >
              {paused ? <Play size={12} /> : <Pause size={12} />}
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
          {running ? (
            <Button variant="danger" size="sm" icon={Square} onClick={stop} aria-label="Stop" className="shrink-0">
              <span className="@max-[1100px]/console:hidden">Stop</span>
            </Button>
          ) : (
            <Button variant="primary" size="sm" icon={Play} onClick={onStart} aria-label="Start" className="shrink-0">
              <span className="@max-[1100px]/console:hidden">Start</span>
            </Button>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-0.5 py-1">
            {filtersVisible && (
              <>
                <span className="h-4 w-px shrink-0 bg-line" />
                <div className="relative shrink-0">
                  <Button
                    ref={appMenuPos.anchorRef}
                    variant="ghost"
                    size="sm"
                    onClick={() => (appMenuOpen ? setAppMenuOpen(false) : openAppMenu())}
                    title={
                      appFilter
                        ? `${appFilter.package}${appFilter.pid != null ? ` (${appFilter.pid})` : ""}`
                        : "Filter by app process"
                    }
                    className={clsx(
                      "max-w-48 font-mono",
                      appFilter && "bg-accent/10! text-accent! hover:text-accent!",
                    )}
                  >
                    <Smartphone size={14} className="shrink-0" />
                    <span className="truncate @max-[1100px]/console:hidden">
                      {appFilter
                        ? `${shortPkg(appFilter.package)}${appFilter.pid != null ? ` · ${appFilter.pid}` : ""}`
                        : "All apps"}
                    </span>
                    <ChevronDown size={12} className="shrink-0 opacity-70 @max-[1100px]/console:hidden" />
                  </Button>
                  {appMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setAppMenuOpen(false)} />
                      <div
                        ref={appMenuPos.menuRef}
                        style={appMenuPos.style}
                        className="anim-pop-in z-30 overflow-auto overscroll-contain rounded-[var(--radius-md)] border border-line bg-surface-2 p-1 text-left shadow-[var(--shadow-3)]"
                      >
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
                                className="focus-ring flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[11px] text-accent transition-colors hover:bg-surface"
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
                                  "focus-ring flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[11px] transition-colors hover:bg-surface disabled:pointer-events-none",
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
                <div
                  role="group"
                  aria-label="Log severity"
                  className="inline-flex shrink-0 items-center rounded-[var(--radius-md)] bg-surface-2 p-0.5"
                >
                  {severity.map((s) => {
                    const active = minLevel === s.level;
                    return (
                      <button
                        key={s.label}
                        type="button"
                        aria-pressed={active}
                        title={s.title}
                        onClick={() => setMinLevel(s.level)}
                        className={clsx(
                          "focus-ring flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-2.5 text-[11px] font-medium transition-colors [transition-duration:var(--dur-base)]",
                          active ? "bg-surface text-txt shadow-[var(--shadow-1)]" : "text-muted hover:text-txt",
                        )}
                      >
                        <span className="@max-[1100px]/console:hidden">{s.label}</span>
                        <span className="hidden @max-[1100px]/console:inline">{s.short}</span>
                        {s.count != null && (
                          <span
                            className={clsx(
                              "font-mono tabular-nums @max-[1180px]/console:hidden",
                              s.level === "Error" && s.count > 0
                                ? "text-danger"
                                : s.level === "Warn" && s.count > 0
                                  ? "text-warn"
                                  : "text-muted/70",
                            )}
                          >
                            {s.count.toLocaleString()}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="w-36 min-w-16 shrink">
                  <Input
                    list="console-observed-tags"
                    mono
                    value={tagQuery}
                    onChange={(e) => setTagQuery(e.target.value)}
                    placeholder="filter by tag"
                    title="Tag filter (server-side)"
                  />
                </div>
                <datalist id="console-observed-tags">
                  {observedTags.slice(-200).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <div className="w-48 min-w-16 shrink">
                  <Input
                    mono
                    value={regex}
                    onChange={(e) => setRegex(e.target.value)}
                    placeholder="search message (regex)"
                    title={regexError ?? "Regex search (client-side)"}
                    className={clsx(regexError != null && "border-danger! text-danger!")}
                  />
                </div>
              </>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1">
            <Menu
              items={bufferItems}
              onClose={() => {}}
              width={140}
              trigger={(t) => (
                <Button
                  ref={t.ref}
                  variant="ghost"
                  size="sm"
                  onClick={t.onClick}
                  aria-haspopup="menu"
                  aria-expanded={t["aria-expanded"]}
                  aria-label="Logcat buffer"
                  title={`Logcat buffer: ${buffer}`}
                >
                  <Layers size={14} className="shrink-0" />
                  <span className="@max-[1600px]/console:hidden">{buffer}</span>
                </Button>
              )}
            />
            <Menu
              items={columnItems}
              onClose={() => {}}
              width={160}
              trigger={(t) => (
                <Button
                  ref={t.ref}
                  variant="ghost"
                  size="sm"
                  onClick={t.onClick}
                  aria-haspopup="menu"
                  aria-expanded={t["aria-expanded"]}
                  aria-label="Columns"
                  title="Choose visible columns"
                  className={clsx(
                    (columns.time || columns.tag || columns.pid || columns.tid) &&
                      "text-accent! hover:text-accent!",
                  )}
                >
                  <AlignLeft size={14} className="shrink-0" />
                  <span className="@max-[1600px]/console:hidden">Columns</span>
                </Button>
              )}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleShell}
              aria-label="Toggle adb shell"
              aria-pressed={shellOpen}
              title="adb shell (open a terminal on the device)"
              className={clsx(shellOpen && "bg-accent/10! text-accent! hover:text-accent!")}
            >
              <Terminal size={14} className="shrink-0" />
              <span className="@max-[1600px]/console:hidden">Shell</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearBuffer}
              aria-label="Clear"
              title="Clear device logcat buffer and view"
            >
              <Eraser size={14} className="shrink-0" />
              <span className="@max-[1600px]/console:hidden">Clear</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onExport}
              disabled={rows.length === 0}
              aria-label="Export"
              title="Export visible rows to a text file"
            >
              <FileDown size={14} className="shrink-0" />
              <span className="@max-[1600px]/console:hidden">Export</span>
            </Button>
          </span>
        </div>
        <div className="relative min-h-0 flex-1">
          {paneMode === "timeline" ? (
            <Suspense fallback={null}>
              <TimelineView />
            </Suspense>
          ) : (
            <div ref={parentRef} onScroll={onScroll} className="h-full overflow-auto py-1">
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
                          <LogRow
                            row={row}
                            cols={columns}
                            onCopy={onCopyLine}
                            onPin={(line) => void invoke("agent_pin_log", { line })}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-line px-4 text-[11px] tabular-nums text-muted/70">
          <span className="shrink-0">
            {lineCount} lines ·{" "}
            <button
              type="button"
              title="Show Error and above"
              onClick={() => setMinLevel("Error")}
              className={clsx("focus-ring rounded-sm hover:underline", stats.errors > 0 ? "text-danger" : "text-muted/50")}
            >
              {stats.errors} errors
            </button>{" "}
            ·{" "}
            <button
              type="button"
              title="Show Warn and above"
              onClick={() => setMinLevel("Warn")}
              className={clsx("focus-ring rounded-sm hover:underline", stats.warns > 0 ? "text-warn" : "text-muted/50")}
            >
              {stats.warns} warns
            </button>
            {pausedDropCount > 0 ? ` · ${pausedDropCount} dropped` : ""}
            {paused && pausedDropCount === 0 ? " · paused" : ""}
          </span>
          <span className="min-w-0 truncate">
            {rows.length} shown · {statusLabel(status)}
          </span>
        </div>
      </section>
      {shellOpen && (
        <>
          <div
            onPointerDown={onShellResizeStart}
            onPointerMove={onShellResizeMove}
            onPointerUp={onShellResizeEnd}
            onPointerCancel={onShellResizeEnd}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize shell"
            className="group flex h-2 shrink-0 cursor-row-resize touch-none select-none items-center justify-center"
          >
            <GripHorizontal
              size={11}
              className="text-muted/50 opacity-0 transition-opacity group-hover:opacity-100"
            />
          </div>
          <section className="panel flex shrink-0 flex-col" style={{ height: shellHeight ?? "40%" }}>
            <div className="flex h-10 shrink-0 items-center gap-2 px-4">
              <span className="text-[12px] font-semibold text-txt">Shell</span>
              <span className="truncate font-mono text-[11px] text-muted" title={`adb shell · ${deviceSerial}`}>
                {deviceSerial}
              </span>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => setShellOpen(false)} title="Hide shell">
                Hide
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <Suspense fallback={null}>
                <ShellPane serial={deviceSerial} />
              </Suspense>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
