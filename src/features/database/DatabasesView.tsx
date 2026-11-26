import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  FileDown,
  GripHorizontal,
  HardDriveDownload,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import { qError } from "../../lib/query";
import {
  loadDbLayout,
  loadSqlHistory,
  loadSqlTabs,
  saveDbLayout,
  saveSqlHistory,
  saveSqlTabs,
} from "../../lib/prefs";
import { EmptyState } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { Menu } from "../../components/ui/Menu";
import { toast } from "../../components/ui/toast";
import { DevicePicker } from "../apks/DevicePicker";
import {
  useAppDatabasesQuery,
  useAppPackagesQuery,
  useApplyDbToDevice,
  useDatabaseTablesQuery,
  useDeleteSnapshot,
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
import { usePaneResize } from "../../lib/usePaneResize";
import { clampPaneWidth, resolvePaneWidth } from "../../lib/pane";
import {
  DBS_WIDTH_BOUNDS,
  DEFAULT_DBS_WIDTH,
  clampDockHeight,
  defaultDockHeight,
  type DbLayout,
} from "./layout";
import {
  activeTab,
  addTab,
  closeTab,
  setActiveTabSql,
  switchTab,
  type SqlTabs,
} from "./tabs";
import {
  beginRun,
  clearTabResults,
  retainTabResults,
  setTabTotal,
  settleRun,
  tabResultFor,
  type TabResults,
} from "./tabResults";
import {
  filterTables,
  formatPulledAt,
  formatRowCount,
  joinExportPath,
  prefillQuery,
  pushHistory,
  queryResultToPage,
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

const TABLE_FILTER_THRESHOLD = 8;

function noop() {}

export function DatabasesView() {
  const [serial, setSerial] = useState("");
  const [pkg, setPkg] = useState<string | null>(null);
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotInfo>>({});
  const [pullError, setPullError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingResult, setExportingResult] = useState(false);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [sqlTabs, setSqlTabs] = useState<SqlTabs>(loadSqlTabs);
  const [sqlHistory, setSqlHistory] = useState<string[]>(loadSqlHistory);
  const [tabResults, setTabResults] = useState<TabResults>(clearTabResults);
  const [editMode, setEditMode] = useState(false);
  const [pendingWrites, setPendingWrites] = useState<PendingWrite[]>([]);
  const [snapshotDirty, setSnapshotDirty] = useState(false);
  const [lastMutation, setLastMutation] = useState<MutationResult | null>(null);
  const [writePanel, setWritePanel] = useState<WritePanel>("none");
  const [tableFilter, setTableFilter] = useState("");
  const runIdRef = useRef(0);
  const [layout, setLayout] = useState<DbLayout>(loadDbLayout);
  const columnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveDbLayout(layout);
  }, [layout]);

  useEffect(() => {
    saveSqlTabs(sqlTabs);
  }, [sqlTabs]);

  useEffect(() => {
    saveSqlHistory(sqlHistory);
  }, [sqlHistory]);

  useEffect(() => {
    setTabResults((r) => retainTabResults(r, sqlTabs.tabs.map((t) => t.id)));
  }, [sqlTabs.tabs]);

  const activeSql = activeTab(sqlTabs).sql;
  const activeTabId = sqlTabs.activeId;
  const current = tabResultFor(tabResults, activeTabId);
  const { result, error: queryError, lastRunSql, page, total, activeTable } = current;

  const dbsResize = usePaneResize({
    grow: "right",
    getSize: () => layout.dbsWidth,
    clamp: (w) => clampPaneWidth(w, DBS_WIDTH_BOUNDS),
    onResized: (w) => setLayout((l) => ({ ...l, dbsWidth: w })),
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
  const deleteSnap = useDeleteSnapshot();
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
  const visibleTables = useMemo(() => filterTables(tables, tableFilter), [tables, tableFilter]);
  const tableFilterActive = tableFilter.trim() !== "";
  const tablesError = qError(tablesQ.error);

  useEffect(() => {
    setPkg(null);
    setSnapshots({});
    setEditMode(false);
    setPendingWrites(clearPending());
    setSnapshotDirty(false);
    setLastMutation(null);
    setWritePanel("none");
  }, [serial]);

  useEffect(() => {
    setSelectedDb(null);
    setPullError(null);
    setEditMode(false);
    setPendingWrites(clearPending());
    setSnapshotDirty(false);
    setLastMutation(null);
    setWritePanel("none");
  }, [pkg]);

  useEffect(() => {
    setSqlOpen(false);
    setTabResults(clearTabResults());
    setEditMode(false);
    setPendingWrites(clearPending());
    setSnapshotDirty(false);
    setLastMutation(null);
    setWritePanel("none");
    setTableFilter("");
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

  function storeSnapshot(dev: string, app: string, name: string, info: SnapshotInfo) {
    setSnapshots((cur) => ({ ...cur, [snapshotKey(dev, app, name)]: info }));
    setTabResults(clearTabResults());
  }

  async function openDb(name: string) {
    if (serial === "" || pkg == null || pull.isPending) return;
    setSelectedDb(name);
    setPullError(null);
    try {
      const info = await pull.mutateAsync({ serial, pkg, dbName: name });
      storeSnapshot(serial, pkg, name, info);
    } catch (e) {
      setPullError(qError(e) ?? String(e));
    }
  }

  async function runSql(
    sqlArg: string,
    opts: { manual: boolean; activeTable?: string | null },
  ) {
    const sql = sqlArg.trim();
    if (sql === "" || run.isPending || runMutation.isPending || !viewerReady) return;
    const tabId = activeTabId;
    const runId = ++runIdRef.current;
    const table = opts.activeTable !== undefined ? opts.activeTable : opts.manual ? null : undefined;
    setTabResults((r) => beginRun(r, tabId, runId, { sql, activeTable: table }));
    if (editMode && isWriteStatement(sql)) {
      await executeWrite(sql);
      setTabResults((r) => settleRun(r, tabId, runId, {}));
      return;
    }
    try {
      const res = await run.mutateAsync({ serial, pkg: pkg ?? "", dbName: selectedDb ?? "", sql });
      setTabResults((r) =>
        settleRun(r, tabId, runId, {
          result: res,
          error: null,
          total: res.truncated ? null : deriveTotal(false, 0, res.row_count, QUERY_PAGE_SIZE),
        }),
      );
      setSqlHistory((h) => pushHistory(h, sql));
      if (res.truncated) void resolveTotal(tabId, sql);
    } catch (e) {
      const message = qError(e) ?? String(e);
      setTabResults((r) => settleRun(r, tabId, runId, { result: null, error: message }));
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
      setSnapshotDirty(true);
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
      setSnapshotDirty(false);
      setWritePanel("none");
      const info = await pull.mutateAsync({ serial, pkg, dbName: selectedDb });
      storeSnapshot(serial, pkg, selectedDb, info);
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
      storeSnapshot(serial, pkg, selectedDb, info);
      setPendingWrites(clearPending());
      setSnapshotDirty(false);
      setLastMutation(null);
      setWritePanel("none");
      toast(`Reverted ${selectedDb} to device state`);
    } catch (e) {
      toast(qError(e) ?? String(e), "danger");
    }
  }

  async function onDeleteSnapshot(name: string) {
    if (serial === "" || pkg == null || deleteSnap.isPending) return;
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const yes = await confirm(
      `Delete the local snapshot of ${name}? Opening it again pulls a fresh copy from the device.`,
      { title: "Delete local snapshot", kind: "warning" },
    );
    if (!yes) return;
    try {
      await deleteSnap.mutateAsync({ serial, pkg, dbName: name });
      const key = snapshotKey(serial, pkg, name);
      setSnapshots((cur) => {
        const next = { ...cur };
        delete next[key];
        return next;
      });
      if (selectedDb === name) {
        setSelectedDb(null);
        setPullError(null);
      }
      toast(`Deleted local snapshot of ${name}`);
    } catch (e) {
      toast(qError(e) ?? String(e), "danger");
    }
  }

  async function refreshAfterWrite() {
    if (lastRunSql != null) await runSql(lastRunSql, { manual: false });
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
    const tabId = activeTabId;
    const sourceSql = lastRunSql;
    const knownTotal = total;
    const runId = ++runIdRef.current;
    const offset = nextPage * QUERY_PAGE_SIZE;
    setTabResults((r) => beginRun(r, tabId, runId));
    try {
      const res = await run.mutateAsync({
        serial,
        pkg: pkg ?? "",
        dbName: selectedDb ?? "",
        sql: wrapPageQuery(sourceSql, QUERY_PAGE_SIZE, offset),
      });
      const derived = deriveTotal(true, offset, res.row_count, QUERY_PAGE_SIZE);
      setTabResults((r) => {
        const prevTotal = tabResultFor(r, tabId).total;
        return settleRun(r, tabId, runId, {
          result: res,
          error: null,
          page: nextPage,
          total: derived != null && prevTotal == null ? derived : prevTotal,
        });
      });
      if (knownTotal == null && (res.truncated || res.row_count >= QUERY_PAGE_SIZE)) {
        void resolveTotal(tabId, sourceSql);
      }
    } catch (e) {
      const message = qError(e) ?? String(e);
      setTabResults((r) => settleRun(r, tabId, runId, { result: null, error: message }));
    }
  }

  async function resolveTotal(tabId: string, sourceSql: string) {
    try {
      const res = await invoke<QueryResult>("run_db_query", {
        serial,
        package: pkg ?? "",
        dbName: selectedDb ?? "",
        sql: wrapCountQuery(sourceSql),
      });
      const count = res.rows[0]?.[0];
      if (typeof count === "number") {
        setTabResults((r) => setTabTotal(r, tabId, sourceSql, count));
      }
    } catch {
      return;
    }
  }

  function onTableClick(name: string, includeRowid = editMode) {
    const sql = prefillQuery(name, includeRowid);
    setSqlTabs((cur) => setActiveTabSql(cur, sql));
    setSqlOpen(true);
    void runSql(sql, { manual: false, activeTable: name });
  }

  function onSqlTextChange(next: string) {
    setSqlTabs((cur) => setActiveTabSql(cur, next));
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

  async function onRevealDb(name: string) {
    if (serial === "" || pkg == null) return;
    try {
      await invoke("reveal_snapshot", { serial, package: pkg, dbName: name });
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
      <div className="panel h-full">
        <EmptyState
          title="Databases runs inside the Beholder app"
          hint="Browse an app's SQLite files on a connected emulator."
        />
      </div>
    );
  }

  const refreshing =
    (packagesQ.isFetching && !packagesQ.isPending) || (dbsQ.isFetching && !dbsQ.isPending);
  const busy = run.isPending || runMutation.isPending;
  const tabRunning = current.running;

  const summaryText =
    tabRunning
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

  const showTableFilter = tables.length > TABLE_FILTER_THRESHOLD || tableFilterActive;
  const pendingCount = pendingWrites.length;

  const tablesTree = viewerReady ? (
    <div className="flex flex-col gap-px pb-1">
      {showTableFilter && (
        <div className="py-1 pl-6 pr-1">
          <input
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && visibleTables.length > 0) {
                onTableClick(visibleTables[0].name);
              }
              if (e.key === "Escape") setTableFilter("");
            }}
            placeholder={`Filter ${formatRowCount(tables.length)} tables`}
            aria-label="Filter tables"
            className="focus-ring h-7 w-full rounded-[var(--radius-md)] border border-line bg-surface-2 px-2 font-mono text-[11px] text-txt transition-colors placeholder:text-muted/60 focus:border-accent"
          />
        </div>
      )}
      {tablesError != null && (
        <div className="pl-6">
          <ErrorBox message={tablesError} compact />
        </div>
      )}
      {tablesError == null && tablesQ.isPending && (
        <p className="flex items-center gap-2 py-1.5 pl-6 text-[11px] text-muted">
          <Loader2 size={12} className="animate-spin" /> Loading tables…
        </p>
      )}
      {tablesError == null && !tablesQ.isPending && tables.length === 0 && (
        <p className="py-1.5 pl-6 text-[11px] text-muted">No tables in this database.</p>
      )}
      {tableFilterActive && visibleTables.length === 0 && (
        <p className="py-1.5 pl-6 text-[11px] text-muted">
          No tables match “{tableFilter.trim()}”.
        </p>
      )}
      {visibleTables.map((t) => (
        <button
          key={t.name}
          type="button"
          onClick={() => onTableClick(t.name)}
          title={prefillQuery(t.name, editMode)}
          aria-current={activeTable === t.name ? "true" : undefined}
          className={clsx(
            "focus-ring flex h-[30px] w-full items-center gap-2 rounded-[var(--radius-md)] pl-6 pr-2.5 text-left text-[12px] transition-colors",
            activeTable === t.name
              ? "bg-accent/12 text-txt"
              : "text-muted hover:bg-surface-2 hover:text-txt",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{t.name}</span>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">
            {formatRowCount(t.row_count)}
          </span>
        </button>
      ))}
    </div>
  ) : null;

  const leftPanel = layout.dbsCollapsed ? (
    <aside
      className="panel flex shrink-0 flex-col items-center gap-2 py-2"
      style={{
        width: resolvePaneWidth({
          collapsed: true,
          width: layout.dbsWidth,
          bounds: DBS_WIDTH_BOUNDS,
        }),
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setLayout((l) => ({ ...l, dbsCollapsed: false }))}
        title="Expand the databases sidebar"
        aria-label="Expand databases sidebar"
      >
        <ChevronRight size={14} />
      </Button>
      <span className="font-mono text-[10px] tabular-nums text-muted">{dbs.length}</span>
    </aside>
  ) : (
    <aside
      className="panel flex shrink-0 flex-col"
      style={{
        width: resolvePaneWidth({
          collapsed: false,
          width: layout.dbsWidth,
          bounds: DBS_WIDTH_BOUNDS,
        }),
      }}
    >
      <div className="flex shrink-0 flex-col gap-1.5 px-2.5 pb-1.5 pt-2.5">
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1">
            <DevicePicker serial={serial} onSelect={setSerial} />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLayout((l) => ({ ...l, dbsCollapsed: true }))}
            title="Collapse the databases sidebar"
            aria-label="Collapse databases sidebar"
          >
            <ChevronLeft size={14} />
          </Button>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1" title={pkg ?? undefined}>
            <PackagePicker
              pkg={pkg}
              apps={apps}
              loading={packagesQ.isPending}
              disabled={serial === ""}
              onSelect={setPkg}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void invalidateAll();
              if (selectedDb != null && activeSnapshot != null) void openDb(selectedDb);
            }}
            disabled={pkg == null || refreshing || pull.isPending}
            title="Refetch the lists and re-pull the selected database snapshot"
            aria-label="Refetch the lists and re-pull the selected database snapshot"
          >
            <RefreshCw size={13} className={refreshing || pull.isPending ? "animate-spin" : ""} />
            Re-pull
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
        {pkg != null && dbsError != null && (
          <div className="flex flex-col gap-2 p-1">
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
        {pkg != null && dbsError == null && dbsLoading && (
          <div className="flex flex-col gap-1 p-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[30px] animate-pulse rounded-[var(--radius-md)] bg-surface-2/60" />
            ))}
          </div>
        )}
        {pkg != null && dbsError == null && !dbsLoading && dbs.length === 0 && (
          <EmptyState
            title="No database files found"
            hint={`Nothing readable under /data/data/${pkg}/databases`}
          />
        )}
        {pkg != null && dbs.length > 0 && (
          <DbList
            dbs={dbs}
            serial={serial}
            pkg={pkg}
            selected={selectedDb}
            pulling={pull.isPending}
            snapshots={snapshots}
            onSelect={(name) => void openDb(name)}
            onDeleteSnapshot={(name) => void onDeleteSnapshot(name)}
            onRevealSnapshot={(name) => void onRevealDb(name)}
          >
            {tablesTree}
          </DbList>
        )}
      </div>
      {pkg != null && (
        <p
          className="shrink-0 border-t border-line/60 px-3.5 py-2.5 text-[11px] leading-relaxed text-muted"
          title={activeSnapshot?.local_path}
        >
          {activeSnapshot != null
            ? `Snapshot pulled at ${formatPulledAt(activeSnapshot.pulled_at_epoch_ms)}. The device file is never modified until you push.`
            : "Snapshots are read-only copies pulled on demand. The device file is never modified until you push."}
        </p>
      )}
    </aside>
  );

  const exportItems = [
    {
      key: "copy",
      label: "Copy as Markdown",
      icon: Copy,
      disabled: tabRunning || result == null || result.rows.length === 0,
      onSelect: () => void onCopyResult(),
    },
    {
      key: "results",
      label: "Export results…",
      icon: FileDown,
      disabled: tabRunning || exportingResult || result == null,
      onSelect: () => void onExportResult(),
    },
    {
      key: "snapshot",
      label: "Export snapshot file…",
      icon: HardDriveDownload,
      disabled: exporting,
      onSelect: () => void onExport(),
    },
  ];

  const pendingList = (
    <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
      {pendingWrites.map((w, i) => (
        <li key={`${w.at}-${i}`} className="flex items-baseline gap-2 font-mono text-[11px]">
          <span className="shrink-0 tabular-nums text-muted">
            {formatRowCount(w.changes)} change{w.changes === 1 ? "" : "s"}
          </span>
          <span className="min-w-0 break-all text-txt/90">{w.sql}</span>
        </li>
      ))}
    </ul>
  );

  const pendingBar = snapshotDirty ? (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
      <div className="pointer-events-auto relative flex max-w-full flex-col items-center">
        {writePanel === "history" && (
          <section className="anim-pop-in absolute bottom-full mb-2 w-[min(560px,90vw)] rounded-[var(--radius-lg)] border border-line bg-surface-2 p-3 shadow-[var(--shadow-3)]">
            <header className="mb-1.5 flex items-center gap-2">
              <span className="text-[11px] font-medium text-muted">Applied to snapshot</span>
              <span className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingWrites(clearPending())}
                  disabled={pendingCount === 0}
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
            {pendingCount > 0 ? (
              pendingList
            ) : (
              <p className="text-[11px] text-muted">
                History is empty; the snapshot still contains any writes you applied.
              </p>
            )}
          </section>
        )}
        {writePanel === "apply" && (
          <section className="anim-pop-in absolute bottom-full mb-2 w-[min(520px,90vw)] rounded-[var(--radius-lg)] border border-line bg-surface-2 p-3 shadow-[var(--shadow-3)]">
            <header className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-txt">Push to device</span>
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
              <span className="text-warn">force-stops {pkg}</span> before pushing and removes its
              -wal and -shm files.
            </p>
            <div className="mt-2.5 flex items-center justify-end gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setWritePanel("none")}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void onApplyToDevice()}
                disabled={applyToDevice.isPending || pull.isPending}
              >
                {applyToDevice.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} />
                )}
                Push to device
              </Button>
            </div>
          </section>
        )}
        <div
          role="status"
          className="flex items-center gap-1.5 rounded-[var(--radius-lg)] border border-line bg-surface-2 py-1.5 pl-3.5 pr-1.5 shadow-[var(--shadow-3)]"
        >
          <span className="mr-1 whitespace-nowrap text-[12px]">
            <span className="font-semibold text-txt">
              {pendingCount > 0
                ? `${formatRowCount(pendingCount)} pending change${pendingCount === 1 ? "" : "s"}`
                : "Unpushed changes"}
            </span>{" "}
            <span className="text-muted">in the snapshot</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWritePanel(writePanel === "history" ? "none" : "history")}
            aria-pressed={writePanel === "history"}
            title="Statements applied to the local snapshot since the last apply or revert"
          >
            Review
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onRevert()}
            disabled={pull.isPending}
            title="Discard local changes and re-pull the snapshot from the device"
          >
            <RotateCcw size={13} className={pull.isPending ? "animate-spin" : ""} />
            Revert
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setWritePanel(writePanel === "apply" ? "none" : "apply")}
            disabled={applyToDevice.isPending || pull.isPending}
            aria-expanded={writePanel === "apply"}
            title="Push the local snapshot to the device (force-stops the app first)"
          >
            {applyToDevice.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            Push to device
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  const viewer = (
    <div ref={columnRef} className="flex min-h-0 flex-1 flex-col">
      <SqlConsole
        serial={serial}
        pkg={pkg ?? ""}
        dbName={selectedDb ?? ""}
        text={activeSql}
        onTextChange={onSqlTextChange}
        tabs={sqlTabs.tabs}
        activeId={sqlTabs.activeId}
        onSwitchTab={(id) => setSqlTabs((cur) => switchTab(cur, id))}
        onCloseTab={(id) => setSqlTabs((cur) => closeTab(cur, id))}
        onAddTab={() => setSqlTabs((cur) => addTab(cur))}
        history={sqlHistory}
        running={busy}
        onRun={(sql) => void runSql(sql, { manual: true })}
        editorOpen={sqlOpen}
        onToggleEditor={() => setSqlOpen((o) => !o)}
        editorHeight={dockHeight}
        resizer={
          <div
            {...dockResize}
            onDoubleClick={() => setLayout((l) => ({ ...l, sqlDockHeight: null }))}
            title="Drag to resize, double-click to reset"
            className="flex h-1.5 shrink-0 cursor-row-resize touch-none select-none items-center justify-center hover:bg-surface-2"
          >
            <GripHorizontal size={11} className="text-muted/70" />
          </div>
        }
      />
      <div className="relative min-h-0 flex-1">
        {queryError != null ? (
          <div className="p-3">
            <ErrorBox message={queryError} />
          </div>
        ) : tabRunning ? (
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
          <EmptyState title="No rows" hint="The query ran successfully and returned nothing" />
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
        {pendingBar}
      </div>
      <footer className="flex min-w-0 shrink-0 items-center gap-2 border-t border-line/60 px-3 py-1.5 text-[11px] text-muted">
        {pagerVisible && (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="font-mono tabular-nums text-txt/80">
              {pageLabel(pagerFrom, pagerTo, total)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void runPage(page - 1)}
              disabled={page === 0 || busy}
              title="Previous page"
              aria-label="Previous page"
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void runPage(page + 1)}
              disabled={pagerOnLastPage || busy}
              title="Next page"
              aria-label="Next page"
            >
              Next
            </Button>
          </span>
        )}
        <span className="shrink-0 whitespace-nowrap font-mono">{summaryText}</span>
        {lastMutation != null && !busy && (
          <span
            title={`Applied to the local snapshot; the grid keeps the previous query result:\n${lastMutation.changes} change${lastMutation.changes === 1 ? "" : "s"} · ${lastMutation.elapsed_ms} ms`}
            className="min-w-0 truncate font-mono"
          >
            {formatRowCount(lastMutation.changes)} row{lastMutation.changes === 1 ? "" : "s"}{" "}
            changed · {lastMutation.elapsed_ms} ms
          </span>
        )}
        {!tabRunning && queryError == null && result?.truncated && (
          <span
            title="The result was capped at 500 rows — narrow it with WHERE or LIMIT"
            className="shrink-0 rounded-[var(--radius-sm)] bg-warn/12 px-1.5 py-px text-[10px] font-medium text-warn"
          >
            truncated
          </span>
        )}
        <span className="ml-auto flex min-w-0 items-center justify-end gap-1.5">
          {!tabRunning && editMode && gridEditable && (
            <span className="min-w-0 truncate">Double-click or right-click a cell to edit</span>
          )}
          {!tabRunning && editMode && !gridEditable && result != null && (
            <span
              className="min-w-0 truncate"
              title="Results of custom queries are read-only — click a table in the sidebar to edit its rows"
            >
              Results of custom queries are read-only — click a table in the sidebar to edit its
              rows
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleEditMode}
            aria-pressed={editMode}
            title="Edit mode: writes apply to the local snapshot, then Apply to device pushes them"
            className={clsx("shrink-0", editMode && "bg-danger/10! text-danger! hover:text-danger!")}
          >
            <Pencil size={13} /> Edit
          </Button>
          <Menu
            items={exportItems}
            onClose={noop}
            width={220}
            trigger={(props) => (
              <Button
                {...props}
                variant="ghost"
                size="sm"
                title="Copy or export the result, or export the snapshot file"
              >
                {exportingResult || exporting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : null}
                Export
                <ChevronDown size={12} />
              </Button>
            )}
          />
        </span>
      </footer>
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      {leftPanel}
      {layout.dbsCollapsed ? (
        <div className="w-2 shrink-0" />
      ) : (
        <div
          {...dbsResize}
          onDoubleClick={() => setLayout((l) => ({ ...l, dbsWidth: DEFAULT_DBS_WIDTH }))}
          title="Drag to resize, double-click to reset"
          className="w-2 shrink-0 cursor-col-resize touch-none select-none"
        />
      )}
      <section className="panel relative flex min-h-0 min-w-0 flex-1 flex-col">
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
          viewer
        ) : null}
      </section>
    </div>
  );
}
