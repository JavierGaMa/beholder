import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  FileDown,
  FolderOpen,
  GripHorizontal,
  Loader2,
  RefreshCw,
  SquareTerminal,
} from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import { qError } from "../../lib/query";
import { loadDbLayout, saveDbLayout } from "../../lib/prefs";
import { EmptyState } from "../../components/ui/primitives";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { toast } from "../../components/ui/toast";
import { DevicePicker } from "../apks/DevicePicker";
import {
  useAppDatabasesQuery,
  useAppPackagesQuery,
  useDatabaseTablesQuery,
  useInvalidateDatabases,
  usePullSnapshot,
  useRunDbQuery,
  type QueryResult,
  type SnapshotInfo,
} from "../../queries/databases";
import { DbList } from "./DbList";
import { PackagePicker } from "./PackagePicker";
import { SqlConsole } from "./SqlConsole";
import { TableGrid } from "./TableGrid";
import { usePaneResize } from "./usePaneResize";
import {
  DBS_WIDTH_BOUNDS,
  DEFAULT_DBS_WIDTH,
  DEFAULT_TABLES_WIDTH,
  TABLES_WIDTH_BOUNDS,
  clampDockHeight,
  clampPaneWidth,
  defaultDockHeight,
  resolvePaneWidth,
  type DbLayout,
} from "./layout";
import {
  formatPulledAt,
  formatRowCount,
  joinExportPath,
  prefillQuery,
  pushHistory,
  queryResultToPage,
  shortPackage,
  snapshotKey,
  sortDatabases,
} from "./dbdisplay";
import {
  exportBaseName,
  formatCsv,
  formatMarkdownTable,
  isPageableQuery,
  pageLabel,
  QUERY_PAGE_SIZE,
  resultSummary,
  wrapCountQuery,
  wrapPageQuery,
} from "./queryResults";

function execCopyCommand(): boolean {
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

function copyViaHiddenTextarea(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = execCopyCommand();
  ta.remove();
  return ok;
}

export function DatabasesView() {
  const [serial, setSerial] = useState("");
  const [pkg, setPkg] = useState<string | null>(null);
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotInfo>>({});
  const [pullError, setPullError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingResult, setExportingResult] = useState(false);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [sqlText, setSqlText] = useState("");
  const [sqlHistory, setSqlHistory] = useState<string[]>([]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [lastRunSql, setLastRunSql] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const lastRunSqlRef = useRef<string | null>(null);
  const [layout, setLayout] = useState<DbLayout>(loadDbLayout);
  const columnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveDbLayout(layout);
  }, [layout]);

  const dbsResize = usePaneResize({
    grow: "right",
    getSize: () => layout.dbsWidth,
    clamp: (w) => clampPaneWidth(w, DBS_WIDTH_BOUNDS),
    onResized: (w) => setLayout((l) => ({ ...l, dbsWidth: w })),
  });
  const tablesResize = usePaneResize({
    grow: "right",
    getSize: () => layout.tablesWidth,
    clamp: (w) => clampPaneWidth(w, TABLES_WIDTH_BOUNDS),
    onResized: (w) => setLayout((l) => ({ ...l, tablesWidth: w })),
  });
  const containerHeight = () => columnRef.current?.clientHeight ?? 600;
  const dockResize = usePaneResize({
    grow: "down",
    getSize: () => layout.sqlDockHeight ?? defaultDockHeight(containerHeight()),
    clamp: (h) => clampDockHeight(h, containerHeight()),
    onResized: (h) => setLayout((l) => ({ ...l, sqlDockHeight: h })),
  });
  const dockHeight = clampDockHeight(
    layout.sqlDockHeight ?? defaultDockHeight(containerHeight()),
    containerHeight(),
  );

  const packagesQ = useAppPackagesQuery(serial, isTauri && serial !== "");
  const dbsQ = useAppDatabasesQuery(serial, pkg ?? "", isTauri && serial !== "" && pkg != null);
  const pull = usePullSnapshot();
  const invalidateAll = useInvalidateDatabases(serial, pkg);
  const run = useRunDbQuery();

  const apps = packagesQ.data ?? [];
  const dbs = useMemo(() => sortDatabases(dbsQ.data ?? []), [dbsQ.data]);
  const dbsError = qError(dbsQ.error);
  const dbsLoading = dbsQ.isPending && pkg != null;

  const activeKey =
    serial !== "" && pkg != null && selectedDb != null
      ? snapshotKey(serial, pkg, selectedDb)
      : null;
  const activeSnapshot = activeKey != null ? snapshots[activeKey] : undefined;
  const viewerReady = activeKey != null && activeSnapshot != null;

  const tablesQ = useDatabaseTablesQuery(serial, pkg ?? "", selectedDb ?? "", viewerReady);
  const tables = useMemo(
    () => [...(tablesQ.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [tablesQ.data],
  );
  const tablesError = qError(tablesQ.error);

  useEffect(() => {
    setPkg(null);
    setSnapshots({});
  }, [serial]);

  useEffect(() => {
    setSelectedDb(null);
    setPullError(null);
  }, [pkg]);

  useEffect(() => {
    setSqlOpen(false);
    setResult(null);
    setQueryError(null);
    setLastRunSql(null);
    setPage(0);
    setTotal(null);
    lastRunSqlRef.current = null;
  }, [selectedDb]);

  useEffect(() => {
    if (!viewerReady) return;
    setSqlOpen(true);
  }, [viewerReady]);

  useLayoutEffect(() => {
    if (columnRef.current == null || layout.sqlDockHeight == null) return;
    const clamped = clampDockHeight(layout.sqlDockHeight, containerHeight());
    if (clamped !== layout.sqlDockHeight) {
      setLayout((l) => ({ ...l, sqlDockHeight: clamped }));
    }
  }, [layout.sqlDockHeight, viewerReady]);

  async function openDb(name: string) {
    if (serial === "" || pkg == null || pull.isPending) return;
    setSelectedDb(name);
    setPullError(null);
    try {
      const info = await pull.mutateAsync({ serial, pkg, dbName: name });
      setSnapshots((cur) => ({ ...cur, [snapshotKey(serial, pkg, name)]: info }));
    } catch (e) {
      setPullError(qError(e) ?? String(e));
    }
  }

  async function runSql(sqlArg?: string) {
    const sql = (sqlArg ?? sqlText).trim();
    if (sql === "" || run.isPending || !viewerReady) return;
    lastRunSqlRef.current = sql;
    setLastRunSql(sql);
    setPage(0);
    setTotal(null);
    try {
      const res = await run.mutateAsync({ serial, pkg: pkg ?? "", dbName: selectedDb ?? "", sql });
      setResult(res);
      setQueryError(null);
      setSqlHistory((h) => pushHistory(h, sql));
      if (!res.truncated) {
        setTotal(res.row_count);
      } else {
        void resolveTotal(sql);
      }
    } catch (e) {
      setResult(null);
      setQueryError(qError(e) ?? String(e));
    }
  }

  async function runPage(nextPage: number) {
    if (lastRunSql == null || run.isPending || !viewerReady || nextPage < 0) return;
    const offset = nextPage * QUERY_PAGE_SIZE;
    try {
      const res = await run.mutateAsync({
        serial,
        pkg: pkg ?? "",
        dbName: selectedDb ?? "",
        sql: wrapPageQuery(lastRunSql, QUERY_PAGE_SIZE, offset),
      });
      setResult(res);
      setQueryError(null);
      setPage(nextPage);
      if (!res.truncated) {
        setTotal(offset + res.row_count);
      } else if (total == null) {
        void resolveTotal(lastRunSql);
      }
    } catch (e) {
      setResult(null);
      setQueryError(qError(e) ?? String(e));
    }
  }

  async function resolveTotal(sourceSql: string) {
    try {
      const res = await invoke<QueryResult>("run_db_query", {
        serial,
        package: pkg ?? "",
        dbName: selectedDb ?? "",
        sql: wrapCountQuery(sourceSql),
      });
      if (lastRunSqlRef.current !== sourceSql) return;
      const count = res.rows[0]?.[0];
      if (typeof count === "number") setTotal(count);
    } catch {
      return;
    }
  }

  function onTableClick(name: string) {
    const sql = prefillQuery(name);
    setSqlText(sql);
    setSqlOpen(true);
    void runSql(sql);
  }

  async function onCopyResult() {
    if (result == null) return;
    const markdown = formatMarkdownTable(result.columns, result.rows);
    let copied: boolean;
    try {
      await navigator.clipboard.writeText(markdown);
      copied = true;
    } catch {
      copied = copyViaHiddenTextarea(markdown);
    }
    if (copied) {
      toast(`Copied ${formatRowCount(result.rows.length)} rows as Markdown`);
    } else {
      toast("Copy failed: clipboard unavailable", "danger");
    }
  }

  async function onExportResult() {
    if (result == null || exportingResult) return;
    setExportingResult(true);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dest = await save({
        filters: [
          { name: "Markdown", extensions: ["md"] },
          { name: "CSV", extensions: ["csv"] },
        ],
        defaultPath: exportBaseName(),
      });
      if (typeof dest !== "string") return;
      const content = dest.toLowerCase().endsWith(".csv")
        ? formatCsv(result.columns, result.rows)
        : formatMarkdownTable(result.columns, result.rows);
      await invoke("export_query_text", { destPath: dest, content });
      toast(`Exported to ${dest}`);
    } catch (e) {
      toast(qError(e) ?? String(e), "danger");
    } finally {
      setExportingResult(false);
    }
  }

  async function onReveal() {
    if (serial === "" || pkg == null || selectedDb == null) return;
    try {
      await invoke("reveal_snapshot", { serial, package: pkg, dbName: selectedDb });
    } catch (e) {
      toast(qError(e) ?? String(e), "danger");
    }
  }

  async function onExport() {
    if (serial === "" || pkg == null || selectedDb == null || exporting) return;
    setExporting(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, title: `Export ${selectedDb} to folder` });
      if (typeof dir !== "string") return;
      const dest = joinExportPath(dir, selectedDb);
      await invoke("export_snapshot", {
        serial,
        package: pkg,
        dbName: selectedDb,
        destPath: dest,
      });
      toast(`Exported to ${dest}`);
    } catch (e) {
      toast(qError(e) ?? String(e), "danger");
    } finally {
      setExporting(false);
    }
  }

  if (!isTauri) {
    return (
      <EmptyState
        title="Databases runs inside the Beholder app"
        hint="Browse an app's SQLite files on a connected emulator."
      />
    );
  }

  const refreshing =
    (packagesQ.isFetching && !packagesQ.isPending) || (dbsQ.isFetching && !dbsQ.isPending);

  const summaryText =
    run.isPending
      ? "running…"
      : result != null && queryError == null
        ? resultSummary(result)
        : "no result";

  const pagerVisible =
    result != null && queryError == null && lastRunSql != null && isPageableQuery(lastRunSql);
  const pagerFrom = result != null && result.rows.length > 0 ? page * QUERY_PAGE_SIZE + 1 : 0;
  const pagerTo = result != null ? page * QUERY_PAGE_SIZE + result.rows.length : 0;
  const pagerOnLastPage =
    total != null ? (page + 1) * QUERY_PAGE_SIZE >= total : result == null || !result.truncated;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
        <DevicePicker serial={serial} onSelect={setSerial} />
        <PackagePicker
          pkg={pkg}
          apps={apps}
          loading={packagesQ.isPending}
          disabled={serial === ""}
          onSelect={setPkg}
        />
        <span className="ml-auto flex items-center gap-2">
          {pkg != null && dbs.length > 0 && (
            <span className="font-mono text-[11px] text-muted/70">
              {dbs.length} database{dbs.length === 1 ? "" : "s"}
            </span>
          )}
          <button
            type="button"
            onClick={() => void invalidateAll()}
            disabled={pkg == null || refreshing}
            title="Refetch the package and database lists"
            className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[12px] text-muted hover:text-txt disabled:opacity-40"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {pkg != null && (
          <aside
            className="flex shrink-0 flex-col border-r border-line"
            style={{
              width: resolvePaneWidth({
                collapsed: layout.dbsCollapsed,
                width: layout.dbsWidth,
                bounds: DBS_WIDTH_BOUNDS,
              }),
            }}
          >
            {layout.dbsCollapsed ? (
              <div className="flex flex-1 flex-col items-center gap-2 py-2">
                <button
                  type="button"
                  onClick={() => setLayout((l) => ({ ...l, dbsCollapsed: false }))}
                  title="Expand the databases sidebar"
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-line text-muted hover:text-txt"
                >
                  <ChevronRight size={11} />
                </button>
                <span className="font-mono text-[10px] tabular-nums text-muted/70">
                  {dbs.length}
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-line/50 px-3 py-1 text-[10px] uppercase tracking-wider text-muted/70">
                  <span className="truncate" title={pkg}>
                    {shortPackage(pkg)}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {dbsQ.isFetching && !dbsQ.isPending && (
                      <Loader2 size={10} className="shrink-0 animate-spin text-accent" />
                    )}
                    <button
                      type="button"
                      onClick={() => setLayout((l) => ({ ...l, dbsCollapsed: true }))}
                      title="Collapse the databases sidebar"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:text-txt"
                    >
                      <ChevronLeft size={11} />
                    </button>
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {dbsError != null && (
                    <div className="flex flex-col gap-2">
                      <ErrorBox message={dbsError} compact />
                      <button
                        type="button"
                        onClick={() => void dbsQ.refetch()}
                        className="h-7 rounded-md border border-line text-[11px] font-medium text-muted hover:text-txt"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {dbsError == null && dbsLoading && (
                    <div className="flex flex-col gap-1.5 p-1">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-12 animate-pulse rounded-md bg-surface-2/60" />
                      ))}
                    </div>
                  )}
                  {dbsError == null && !dbsLoading && dbs.length === 0 && (
                    <EmptyState
                      title="No database files found"
                      hint={`Nothing readable under /data/data/${pkg}/databases`}
                    />
                  )}
                  {dbs.length > 0 && (
                    <DbList
                      dbs={dbs}
                      serial={serial}
                      pkg={pkg}
                      selected={selectedDb}
                      pulling={pull.isPending}
                      snapshots={snapshots}
                      onSelect={(name) => void openDb(name)}
                    />
                  )}
                </div>
              </>
            )}
          </aside>
        )}
        {pkg != null && !layout.dbsCollapsed && (
          <div
            {...dbsResize}
            onDoubleClick={() => setLayout((l) => ({ ...l, dbsWidth: DEFAULT_DBS_WIDTH }))}
            title="Drag to resize, double-click to reset"
            className="w-1.5 shrink-0 cursor-col-resize touch-none select-none hover:bg-surface-2"
          />
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedDb == null ? (
            <EmptyState
              title={pkg == null ? "Select a package to browse its databases" : "Select a database"}
              hint={
                pkg == null
                  ? "Pick an installed app, then choose one of its SQLite files."
                  : "A read-only snapshot is pulled from the device on demand. The device file is never modified."
              }
            />
          ) : !viewerReady && pull.isPending ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Loader2 size={18} className="animate-spin text-accent" />
              <p className="text-sm text-muted">
                Pulling <span className="font-mono text-txt/90">{selectedDb}</span> from the device…
              </p>
              <p className="text-xs text-muted/70">adb pull of the db, -wal and -shm files</p>
            </div>
          ) : !viewerReady && pullError != null ? (
            <div className="mx-auto flex w-full max-w-xl flex-col gap-2 p-6">
              <ErrorBox message={pullError} />
              <button
                type="button"
                onClick={() => void openDb(selectedDb)}
                className="h-7 self-start rounded-md border border-line px-2.5 text-[11px] font-medium text-muted hover:text-txt"
              >
                Retry pull
              </button>
            </div>
          ) : viewerReady ? (
            <div ref={columnRef} className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1">
                <aside
                  className="flex shrink-0 flex-col border-r border-line"
                  style={{
                    width: resolvePaneWidth({
                      collapsed: layout.tablesCollapsed,
                      width: layout.tablesWidth,
                      bounds: TABLES_WIDTH_BOUNDS,
                    }),
                  }}
                >
                  {layout.tablesCollapsed ? (
                    <div className="flex flex-1 flex-col items-center gap-2 py-2">
                      <button
                        type="button"
                        onClick={() => setLayout((l) => ({ ...l, tablesCollapsed: false }))}
                        title="Expand the tables sidebar"
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-line text-muted hover:text-txt"
                      >
                        <ChevronRight size={11} />
                      </button>
                      <span className="font-mono text-[10px] tabular-nums text-muted/70">
                        {tables.length}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2 border-b border-line/50 px-3 py-1 text-[10px] uppercase tracking-wider text-muted/70">
                        <span>tables · {formatRowCount(tables.length)}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {tablesQ.isFetching && !tablesQ.isPending && (
                            <Loader2 size={10} className="shrink-0 animate-spin text-accent" />
                          )}
                          <button
                            type="button"
                            onClick={() => setLayout((l) => ({ ...l, tablesCollapsed: true }))}
                            title="Collapse the tables sidebar"
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:text-txt"
                          >
                            <ChevronLeft size={11} />
                          </button>
                        </span>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                        {tablesError != null && <ErrorBox message={tablesError} compact />}
                        {tablesError == null && tablesQ.isPending && (
                          <p className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted">
                            <Loader2 size={12} className="animate-spin" /> Loading tables…
                          </p>
                        )}
                        {tablesError == null && !tablesQ.isPending && tables.length === 0 && (
                          <p className="px-2 py-2 text-[11px] text-muted">
                            No tables in this database.
                          </p>
                        )}
                        <div className="flex flex-col gap-0.5">
                          {tables.map((t) => (
                            <button
                              key={t.name}
                              type="button"
                              onClick={() => onTableClick(t.name)}
                              title={`SELECT * FROM "${t.name}" LIMIT 50`}
                              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-[11px] text-txt/90 transition-colors hover:bg-surface-2"
                            >
                              <span className="min-w-0 flex-1 truncate">{t.name}</span>
                              <span className="shrink-0 text-[10px] tabular-nums text-muted/70">
                                {formatRowCount(t.row_count)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </aside>
                {!layout.tablesCollapsed && (
                  <div
                    {...tablesResize}
                    onDoubleClick={() => setLayout((l) => ({ ...l, tablesWidth: DEFAULT_TABLES_WIDTH }))}
                    title="Drag to resize, double-click to reset"
                    className="w-1.5 shrink-0 cursor-col-resize touch-none select-none hover:bg-surface-2"
                  />
                )}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  {sqlOpen && (
                    <section
                      className="flex shrink-0 flex-col border-b border-line bg-surface"
                      style={{ height: dockHeight }}
                    >
                      <SqlConsole
                        serial={serial}
                        pkg={pkg ?? ""}
                        dbName={selectedDb ?? ""}
                        text={sqlText}
                        onTextChange={setSqlText}
                        history={sqlHistory}
                        running={run.isPending}
                        onRun={() => void runSql()}
                        onClose={() => setSqlOpen(false)}
                      />
                      <div
                        {...dockResize}
                        onDoubleClick={() => setLayout((l) => ({ ...l, sqlDockHeight: null }))}
                        title="Drag to resize, double-click to reset"
                        className="flex h-1.5 shrink-0 cursor-row-resize touch-none select-none items-center justify-center hover:bg-surface-2"
                      >
                        <GripHorizontal size={11} className="text-muted/70" />
                      </div>
                    </section>
                  )}
                  <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-1">
                    <span className="font-mono text-[11px] text-muted">{summaryText}</span>
                    {!run.isPending && queryError == null && result?.truncated && (
                      <span
                        title="The result was capped at 500 rows — narrow it with WHERE or LIMIT"
                        className="rounded-sm border border-warn/40 bg-warn/10 px-1.5 py-px text-[10px] font-medium text-warn"
                      >
                        truncated
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void onCopyResult()}
                        disabled={run.isPending || result == null || result.rows.length === 0}
                        title="Copy the result as Markdown to the clipboard"
                        className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] text-muted hover:text-txt disabled:opacity-40"
                      >
                        <Copy size={11} /> Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => void onExportResult()}
                        disabled={run.isPending || exportingResult || result == null}
                        title="Export the result as Markdown or CSV"
                        className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] text-muted hover:text-txt disabled:opacity-40"
                      >
                        {exportingResult ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <FileDown size={11} />
                        )}{" "}
                        Export
                      </button>
                    </span>
                  </div>
                  <div className="min-h-0 flex-1">
                    {queryError != null ? (
                      <div className="p-3">
                        <ErrorBox message={queryError} />
                      </div>
                    ) : run.isPending ? (
                      <div className="flex h-full items-center justify-center">
                        <Loader2 size={16} className="animate-spin text-accent" />
                      </div>
                    ) : result == null ? (
                      <EmptyState
                        icon={<Database size={20} />}
                        title="Run a query to see results"
                        hint={`Type SQL above or click a table in the sidebar · ${selectedDb}`}
                      />
                    ) : result.rows.length === 0 ? (
                      <EmptyState
                        title="No rows"
                        hint="The query ran successfully and returned nothing"
                      />
                    ) : (
                      <TableGrid
                        page={queryResultToPage(result)}
                        offsetBase={page * QUERY_PAGE_SIZE}
                      />
                    )}
                  </div>
                  {pagerVisible && (
                    <div className="flex h-8 shrink-0 items-center justify-center gap-2 border-t border-line bg-surface px-3 py-1 text-[11px] text-muted">
                      <button
                        type="button"
                        onClick={() => void runPage(page - 1)}
                        disabled={page === 0 || run.isPending}
                        title="Previous page"
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-line text-muted hover:text-txt disabled:opacity-40"
                      >
                        <ChevronLeft size={11} />
                      </button>
                      <span className="font-mono tabular-nums">
                        {pageLabel(pagerFrom, pagerTo, total)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void runPage(page + 1)}
                        disabled={pagerOnLastPage || run.isPending}
                        title="Next page"
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-line text-muted hover:text-txt disabled:opacity-40"
                      >
                        <ChevronRight size={11} />
                      </button>
                    </div>
                  )}
                  <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-3 py-1 text-[11px] text-muted">
                    <span className="ml-auto flex items-center gap-2">
                      {activeSnapshot != null && (
                        <span
                          className="font-mono text-[10px] text-muted/70"
                          title={activeSnapshot.local_path}
                        >
                          snapshot {formatPulledAt(activeSnapshot.pulled_at_epoch_ms)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => selectedDb != null && void openDb(selectedDb)}
                        disabled={pull.isPending}
                        title="Pull a fresh snapshot and reload"
                        className="flex h-7 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-muted hover:text-txt disabled:opacity-40"
                      >
                        <RefreshCw size={11} className={pull.isPending ? "animate-spin" : ""} />{" "}
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => setSqlOpen(!sqlOpen)}
                        title={
                          sqlOpen
                            ? "Hide the SQL console"
                            : "Open a read-only SQL console on this snapshot"
                        }
                        className={clsx(
                          "flex h-7 items-center gap-1 rounded-md border px-1.5 text-[11px] hover:text-txt",
                          sqlOpen
                            ? "border-accent/40 bg-accent/10 text-accent"
                            : "border-line text-muted",
                        )}
                      >
                        <SquareTerminal size={11} /> SQL
                      </button>
                      <button
                        type="button"
                        onClick={() => void onReveal()}
                        title="Reveal the snapshot file in Finder"
                        className="flex h-7 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-muted hover:text-txt"
                      >
                        <FolderOpen size={11} /> Reveal
                      </button>
                      <button
                        type="button"
                        onClick={() => void onExport()}
                        disabled={exporting}
                        title="Copy the snapshot to a folder you pick"
                        className="flex h-7 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-muted hover:text-txt disabled:opacity-40"
                      >
                        {exporting ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <FileDown size={11} />
                        )}{" "}
                        Export…
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
