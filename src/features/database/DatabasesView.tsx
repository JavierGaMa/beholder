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
  Pencil,
  RefreshCw,
  RotateCcw,
  SquareTerminal,
  Upload,
  X,
} from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import { qError } from "../../lib/query";
import { loadDbLayout, saveDbLayout } from "../../lib/prefs";
import { EmptyState } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { toast } from "../../components/ui/toast";
import { DevicePicker } from "../apks/DevicePicker";
import {
  useAppDatabasesQuery,
  useAppPackagesQuery,
  useApplyDbToDevice,
  useDatabaseTablesQuery,
  useInvalidateDatabases,
  usePullSnapshot,
  useRunDbMutation,
  useRunDbQuery,
  type MutationResult,
  type QueryResult,
  type SnapshotInfo,
} from "../../queries/databases";
import { DbList } from "./DbList";
import { copyText } from "./clipboard";
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
  deriveTotal,
  exportBaseName,
  formatCsv,
  formatMarkdownTable,
  isEditableResult,
  isPageableQuery,
  pageLabel,
  QUERY_PAGE_SIZE,
  resultSummary,
  wrapCountQuery,
  wrapPageQuery,
} from "./queryResults";
import {
  appendPending,
  cellUpdateSql,
  clearPending,
  deleteRowSql,
  isWriteStatement,
  type PendingWrite,
} from "./writes";

type WritePanel = "none" | "history" | "apply";

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
  const [editMode, setEditMode] = useState(false);
  const [pendingWrites, setPendingWrites] = useState<PendingWrite[]>([]);
  const [lastMutation, setLastMutation] = useState<MutationResult | null>(null);
  const [writePanel, setWritePanel] = useState<WritePanel>("none");
  const [activeTable, setActiveTable] = useState<string | null>(null);
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
  const runMutation = useRunDbMutation();
  const applyToDevice = useApplyDbToDevice();

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
    setEditMode(false);
    setPendingWrites(clearPending());
    setLastMutation(null);
    setWritePanel("none");
  }, [serial]);

  useEffect(() => {
    setSelectedDb(null);
    setPullError(null);
    setEditMode(false);
    setPendingWrites(clearPending());
    setLastMutation(null);
    setWritePanel("none");
  }, [pkg]);

  useEffect(() => {
    setSqlOpen(false);
    setResult(null);
    setQueryError(null);
    setLastRunSql(null);
    setPage(0);
    setTotal(null);
    setEditMode(false);
    setPendingWrites(clearPending());
    setLastMutation(null);
    setWritePanel("none");
    setActiveTable(null);
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
    if (sql === "" || run.isPending || runMutation.isPending || !viewerReady) return;
    if (sqlArg == null) setActiveTable(null);
    lastRunSqlRef.current = sql;
    setLastRunSql(sql);
    setPage(0);
    setTotal(null);
    if (editMode && isWriteStatement(sql)) {
      await executeWrite(sql);
      return;
    }
    try {
      const res = await run.mutateAsync({ serial, pkg: pkg ?? "", dbName: selectedDb ?? "", sql });
      setResult(res);
      setQueryError(null);
      setSqlHistory((h) => pushHistory(h, sql));
      if (res.truncated) {
        void resolveTotal(sql);
      } else {
        setTotal(deriveTotal(false, 0, res.row_count, QUERY_PAGE_SIZE));
      }
    } catch (e) {
      setResult(null);
      setQueryError(qError(e) ?? String(e));
    }
  }

  async function executeWrite(sql: string): Promise<boolean> {
    if (!viewerReady || selectedDb == null) return false;
    try {
      const res = await runMutation.mutateAsync({
        serial,
        pkg: pkg ?? "",
        dbName: selectedDb,
        sql,
      });
      setPendingWrites((w) => appendPending(w, { sql, changes: res.changes, at: Date.now() }));
      setLastMutation(res);
      return true;
    } catch (e) {
      toast(qError(e) ?? String(e), "danger");
      return false;
    }
  }

  async function onApplyToDevice() {
    if (!viewerReady || selectedDb == null || pkg == null || applyToDevice.isPending) return;
    try {
      await applyToDevice.mutateAsync({ serial, pkg, dbName: selectedDb });
      setPendingWrites(clearPending());
      setWritePanel("none");
      const info = await pull.mutateAsync({ serial, pkg, dbName: selectedDb });
      setSnapshots((cur) => ({ ...cur, [snapshotKey(serial, pkg, selectedDb)]: info }));
      toast(`Applied ${selectedDb} to ${serial}`);
    } catch (e) {
      toast(qError(e) ?? String(e), "danger");
    }
  }

  async function onRevert() {
    if (!viewerReady || selectedDb == null || pkg == null || pull.isPending) return;
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const yes = await confirm(
        `Discard local changes and re-pull ${selectedDb} from the device?`,
        { title: "Revert to device state", kind: "warning" },
    );
    if (!yes) return;
    try {
      const info = await pull.mutateAsync({ serial, pkg, dbName: selectedDb });
      setSnapshots((cur) => ({ ...cur, [snapshotKey(serial, pkg, selectedDb)]: info }));
      setPendingWrites(clearPending());
      setLastMutation(null);
      setWritePanel("none");
      toast(`Reverted ${selectedDb} to device state`);
    } catch (e) {
      toast(qError(e) ?? String(e), "danger");
    }
  }

  async function refreshAfterWrite() {
    const sql = lastRunSqlRef.current;
    if (sql != null) await runSql(sql);
  }

  async function commitCellEdit(
    col: string,
    value: number | string | null,
    rowid: number,
  ) {
    if (!viewerReady || activeTable == null) return;
    const ok = await executeWrite(cellUpdateSql(activeTable, col, value, rowid));
    if (ok) await refreshAfterWrite();
  }

  async function onDeleteRow(rowid: number) {
    if (!viewerReady || activeTable == null) return;
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const yes = await confirm(
      `Delete row ${rowid} from "${activeTable}" on the local snapshot?`,
      { title: "Delete row", kind: "warning" },
    );
    if (!yes) return;
    const ok = await executeWrite(deleteRowSql(activeTable, rowid));
    if (ok) await refreshAfterWrite();
  }

  async function runPage(nextPage: number) {
    if (lastRunSql == null || run.isPending || runMutation.isPending || !viewerReady || nextPage < 0)
      return;
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
      const derived = deriveTotal(true, offset, res.row_count, QUERY_PAGE_SIZE);
      if (derived != null && total == null) {
        setTotal(derived);
      }
      if (total == null && (res.truncated || res.row_count >= QUERY_PAGE_SIZE)) {
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

  function onTableClick(name: string, includeRowid = editMode) {
    setActiveTable(name);
    const sql = prefillQuery(name, includeRowid);
    setSqlText(sql);
    setSqlOpen(true);
    void runSql(sql);
  }

  function onToggleEditMode() {
    const next = !editMode;
    setEditMode(next);
    if (!next || activeTable == null || isEditableResult(result)) return;
    onTableClick(activeTable, true);
  }

  async function onCopyResult() {
    if (result == null) return;
    const markdown = formatMarkdownTable(result.columns, result.rows);
    if (await copyText(markdown)) {
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

  const gridEditable = editMode && activeTable != null && isEditableResult(result);

  const pagerVisible =
    result != null && queryError == null && lastRunSql != null && isPageableQuery(lastRunSql);
  const pagerFrom = result != null && result.rows.length > 0 ? page * QUERY_PAGE_SIZE + 1 : 0;
  const pagerTo = result != null ? page * QUERY_PAGE_SIZE + result.rows.length : 0;
  const pagerOnLastPage =
    total != null ? (page + 1) * QUERY_PAGE_SIZE >= total : result == null || !result.truncated;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
        <DevicePicker serial={serial} onSelect={setSerial} />
        <PackagePicker
          pkg={pkg}
          apps={apps}
          loading={packagesQ.isPending}
          disabled={serial === ""}
          onSelect={setPkg}
        />
        <span className="ml-auto flex min-w-0 items-center gap-2">
          {pkg != null && dbs.length > 0 && (
            <span className="font-mono text-[11px] text-muted/70">
              {dbs.length} database{dbs.length === 1 ? "" : "s"}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void invalidateAll()}
            disabled={pkg == null || refreshing}
            title="Refetch the package and database lists"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
          </Button>
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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setLayout((l) => ({ ...l, dbsCollapsed: false }))}
                  title="Expand the databases sidebar"
                  aria-label="Expand databases sidebar"
                >
                  <ChevronRight size={14} />
                </Button>
                <span className="font-mono text-[10px] tabular-nums text-muted/70">
                  {dbs.length}
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-line/50 px-3 py-1 text-[10px] uppercase tracking-wider text-muted/70">
                  <span className="min-w-0 truncate" title={pkg}>
                    {shortPackage(pkg)}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {dbsQ.isFetching && !dbsQ.isPending && (
                      <Loader2 size={10} className="shrink-0 animate-spin text-accent" />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setLayout((l) => ({ ...l, dbsCollapsed: true }))}
                      title="Collapse the databases sidebar"
                      aria-label="Collapse databases sidebar"
                    >
                      <ChevronLeft size={14} />
                    </Button>
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {dbsError != null && (
                    <div className="flex flex-col gap-2">
                      <ErrorBox message={dbsError} compact />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void dbsQ.refetch()}
                        className="self-start"
                      >
                        Retry
                      </Button>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void openDb(selectedDb)}
                className="self-start"
              >
                Retry pull
              </Button>
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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setLayout((l) => ({ ...l, tablesCollapsed: false }))}
                  title="Expand the tables sidebar"
                  aria-label="Expand tables sidebar"
                >
                  <ChevronRight size={14} />
                </Button>
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
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setLayout((l) => ({ ...l, tablesCollapsed: true }))}
                            title="Collapse the tables sidebar"
                            aria-label="Collapse tables sidebar"
                          >
                            <ChevronLeft size={14} />
                          </Button>
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
                              title={prefillQuery(t.name, editMode)}
                              className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-[11px] text-txt/90 transition-colors hover:bg-surface-2"
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
                        running={run.isPending || runMutation.isPending}
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
                  <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-1">
                    <span className="min-w-0 truncate font-mono text-[11px] text-muted">{summaryText}</span>
                    {lastMutation != null && !run.isPending && !runMutation.isPending && (
                      <span
                        title={`Applied to the local snapshot; the grid keeps the previous query result:\n${lastMutation.changes} change${lastMutation.changes === 1 ? "" : "s"} · ${lastMutation.elapsed_ms} ms`}
                        className="min-w-0 truncate font-mono text-[11px] text-accent"
                      >
                        {formatRowCount(lastMutation.changes)} row{lastMutation.changes === 1 ? "" : "s"}{" "}
                        changed · {lastMutation.elapsed_ms} ms
                      </span>
                    )}
                    {!run.isPending && queryError == null && result?.truncated && (
                      <span
                        title="The result was capped at 500 rows — narrow it with WHERE or LIMIT"
                        className="rounded-sm border border-warn/40 bg-warn/10 px-1.5 py-px text-[10px] font-medium text-warn"
                      >
                        truncated
                      </span>
                    )}
                    {!run.isPending && editMode && gridEditable && (
                      <span className="text-[10px] text-muted">
                        Double-click or right-click a cell to edit
                      </span>
                    )}
                    {!run.isPending && editMode && !gridEditable && result != null && (
                      <span className="text-[10px] text-muted">
                        Results of custom queries are read-only — click a table in the sidebar to
                        edit its rows
                      </span>
                    )}
                    <span className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
                      {editMode && pendingWrites.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setWritePanel(writePanel === "history" ? "none" : "history")
                          }
                          title="Statements applied to the local snapshot since the last apply or revert"
                          className="border-warn/40! bg-warn/10! text-warn! hover:text-warn!"
                        >
                          {pendingWrites.length} pending
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onToggleEditMode}
                        aria-pressed={editMode}
                        title="Edit mode: writes apply to the local snapshot, then Apply to device pushes them"
                        className={clsx(
                          editMode &&
                            "border-danger/40! bg-danger/10! text-danger! hover:text-danger!",
                        )}
                      >
                        <Pencil size={14} /> Edit
                      </Button>
                      {editMode && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void onRevert()}
                            disabled={pull.isPending}
                            title="Discard local changes and re-pull the snapshot from the device"
                          >
                            <RotateCcw size={14} className={pull.isPending ? "animate-spin" : ""} />{" "}
                            Revert
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() =>
                              setWritePanel(writePanel === "apply" ? "none" : "apply")
                            }
                            disabled={applyToDevice.isPending || pull.isPending}
                            title="Push the local snapshot to the device (force-stops the app first)"
                            className="border-danger/40! bg-danger/10!"
                          >
                            {applyToDevice.isPending ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Upload size={14} />
                            )}{" "}
                            Apply to device
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void onCopyResult()}
                        disabled={run.isPending || result == null || result.rows.length === 0}
                        title="Copy the result as Markdown to the clipboard"
                      >
                        <Copy size={14} /> Copy
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void onExportResult()}
                        disabled={run.isPending || exportingResult || result == null}
                        title="Export the result as Markdown or CSV"
                      >
                        {exportingResult ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <FileDown size={14} />
                        )}{" "}
                        Export
                      </Button>
                    </span>
                  </div>
                  {editMode && writePanel === "history" && (
                    <section className="shrink-0 border-b border-line bg-surface px-3 py-2">
                      <header className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted/70">
                          Applied to snapshot
                        </span>
                        <span className="ml-auto flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingWrites(clearPending())}
                            title="Clear this list only; statements already applied to the snapshot stay applied"
                          >
                            Clear
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setWritePanel("none")}
                            title="Close the statement list"
                            aria-label="Close statement list"
                          >
                            <X size={14} />
                          </Button>
                        </span>
                      </header>
                      <ul className="mt-1.5 flex max-h-40 flex-col gap-1 overflow-y-auto">
                        {pendingWrites.map((w, i) => (
                          <li
                            key={`${w.at}-${i}`}
                            className="flex items-baseline gap-2 font-mono text-[11px]"
                          >
                            <span className="shrink-0 tabular-nums text-muted/60">
                              {formatRowCount(w.changes)} change{w.changes === 1 ? "" : "s"}
                            </span>
                            <span className="min-w-0 break-all text-txt/90">{w.sql}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {editMode && writePanel === "apply" && (
                    <section className="shrink-0 border-b border-line bg-surface px-3 py-2">
                      <header className="flex items-center gap-2">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-danger">
                          Apply to device
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setWritePanel("none")}
                          title="Close without pushing"
                          aria-label="Close apply panel"
                          className="ml-auto"
                        >
                          <X size={14} />
                        </Button>
                      </header>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted">
                        Pushes the local snapshot of{" "}
                        <span className="font-mono text-txt/90">{selectedDb}</span> to{" "}
                        <span className="font-mono text-txt/90">{pkg}</span> on{" "}
                        <span className="font-mono text-txt/90">{serial}</span>. This{" "}
                        <span className="text-warn">force-stops {pkg}</span> before pushing and
                        removes its -wal and -shm files.
                      </p>
                      {pendingWrites.length > 0 ? (
                        <ul className="mt-1.5 flex max-h-40 flex-col gap-1 overflow-y-auto">
                          {pendingWrites.map((w, i) => (
                            <li
                              key={`${w.at}-${i}`}
                              className="flex items-baseline gap-2 font-mono text-[11px]"
                            >
                              <span className="shrink-0 tabular-nums text-muted/60">
                                {formatRowCount(w.changes)} change{w.changes === 1 ? "" : "s"}
                              </span>
                              <span className="min-w-0 break-all text-txt/90">{w.sql}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-[11px] text-muted/70">
                          History is empty; the snapshot still contains any writes you applied.
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setWritePanel("none")}>
                          Cancel
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void onApplyToDevice()}
                          disabled={applyToDevice.isPending || pull.isPending}
                          className="border-danger/40! bg-danger/10!"
                        >
                          {applyToDevice.isPending ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Upload size={14} />
                          )}{" "}
                          Push to device
                        </Button>
                      </div>
                    </section>
                  )}
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
                        editing={editMode && activeTable != null}
                        onCommitCell={(col, value, rowid) => void commitCellEdit(col, value, rowid)}
                        onDeleteRow={(rowid) => void onDeleteRow(rowid)}
                        copyText={copyText}
                      />
                    )}
                  </div>
                  {pagerVisible && (
                    <div className="flex h-8 shrink-0 items-center justify-center gap-2 border-t border-line bg-surface px-3 py-1 text-[11px] text-muted">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void runPage(page - 1)}
                        disabled={page === 0 || run.isPending}
                        title="Previous page"
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={14} />
                      </Button>
                      <span className="font-mono tabular-nums">
                        {pageLabel(pagerFrom, pagerTo, total)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void runPage(page + 1)}
                        disabled={pagerOnLastPage || run.isPending}
                        title="Next page"
                        aria-label="Next page"
                      >
                        <ChevronRight size={14} />
                      </Button>
                    </div>
                  )}
                  <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-3 py-1 text-[11px] text-muted">
                    <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                      {activeSnapshot != null && (
                        <span
                          className="min-w-0 truncate font-mono text-[10px] text-muted/70"
                          title={activeSnapshot.local_path}
                        >
                          snapshot {formatPulledAt(activeSnapshot.pulled_at_epoch_ms)}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => selectedDb != null && void openDb(selectedDb)}
                        disabled={pull.isPending}
                        title="Pull a fresh snapshot and reload"
                      >
                        <RefreshCw size={14} className={pull.isPending ? "animate-spin" : ""} />{" "}
                        Refresh
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSqlOpen(!sqlOpen)}
                        aria-pressed={sqlOpen}
                        title={
                          sqlOpen
                            ? "Hide the SQL console"
                            : "Open a read-only SQL console on this snapshot"
                        }
                        className={clsx(
                          sqlOpen &&
                            "border-accent/40! bg-accent/10! text-accent! hover:text-accent!",
                        )}
                      >
                        <SquareTerminal size={14} /> SQL
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={FolderOpen}
                        onClick={() => void onReveal()}
                        title="Reveal the snapshot file in Finder"
                      >
                        Reveal
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void onExport()}
                        disabled={exporting}
                        title="Copy the snapshot to a folder you pick"
                      >
                        {exporting ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <FileDown size={14} />
                        )}{" "}
                        Export…
                      </Button>
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
