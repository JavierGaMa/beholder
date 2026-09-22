import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  ChevronLeft,
  ChevronRight,
  FileDown,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  SquareTerminal,
  X,
} from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import { qError } from "../../lib/query";
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
  useTableRowsQuery,
  type SnapshotInfo,
  type TableOrder,
} from "../../queries/databases";
import { DbList } from "./DbList";
import { PackagePicker } from "./PackagePicker";
import { SqlConsole } from "./SqlConsole";
import { TableGrid } from "./TableGrid";
import {
  clampPage,
  formatPulledAt,
  formatRowCount,
  joinExportPath,
  nextOrderState,
  normalizeSearch,
  pageCount,
  prefillQuery,
  pushHistory,
  shortPackage,
  snapshotKey,
  sortDatabases,
} from "./dbdisplay";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

export function DatabasesView() {
  const [serial, setSerial] = useState("");
  const [pkg, setPkg] = useState<string | null>(null);
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<TableOrder | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotInfo>>({});
  const [pullError, setPullError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [sqlText, setSqlText] = useState("");
  const [sqlHistory, setSqlHistory] = useState<string[]>([]);

  const packagesQ = useAppPackagesQuery(serial, isTauri && serial !== "");
  const dbsQ = useAppDatabasesQuery(serial, pkg ?? "", isTauri && serial !== "" && pkg != null);
  const pull = usePullSnapshot();
  const invalidateAll = useInvalidateDatabases(serial, pkg);

  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);
  const querySearch = normalizeSearch(debouncedSearch) ?? "";

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

  const rowsQ = useTableRowsQuery(
    serial,
    pkg ?? "",
    selectedDb ?? "",
    table ?? "",
    page,
    PAGE_SIZE,
    querySearch,
    order,
    viewerReady && table != null,
  );
  const tablePage = rowsQ.data;
  const rowsError = qError(rowsQ.error);
  const totalPages = tablePage != null ? pageCount(tablePage.total_rows, PAGE_SIZE) : 0;

  useEffect(() => {
    setPkg(null);
    setSnapshots({});
  }, [serial]);

  useEffect(() => {
    setSelectedDb(null);
    setPullError(null);
  }, [pkg]);

  useEffect(() => {
    setTable(null);
    setPage(0);
    setSearch("");
    setOrder(null);
    setSqlOpen(false);
  }, [selectedDb]);

  useEffect(() => {
    setPage(0);
    setSearch("");
    setOrder(null);
  }, [table]);

  useEffect(() => {
    setPage(0);
  }, [querySearch, order]);

  useEffect(() => {
    if (!viewerReady) return;
    if (tables.length === 0) {
      setTable(null);
      return;
    }
    if (table == null || !tables.some((t) => t.name === table)) setTable(tables[0].name);
  }, [tables, table, viewerReady]);

  useEffect(() => {
    if (tablePage == null) return;
    const clamped = clampPage(page, tablePage.total_rows, PAGE_SIZE);
    if (clamped !== page) setPage(clamped);
  }, [tablePage, page]);

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

  function toggleSql() {
    if (!sqlOpen && sqlText.trim() === "") setSqlText(prefillQuery(table));
    setSqlOpen(!sqlOpen);
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
          <aside className="flex w-72 shrink-0 flex-col border-r border-line">
            <div className="flex items-center justify-between gap-2 border-b border-line/50 px-3 py-1 text-[10px] uppercase tracking-wider text-muted/70">
              <span className="truncate" title={pkg}>
                {shortPackage(pkg)}
              </span>
              {dbsQ.isFetching && !dbsQ.isPending && (
                <Loader2 size={10} className="shrink-0 animate-spin text-accent" />
              )}
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
          </aside>
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
            <div className="flex min-h-0 flex-1 flex-col">
              {sqlOpen && (
                <SqlConsole
                  serial={serial}
                  pkg={pkg ?? ""}
                  dbName={selectedDb ?? ""}
                  table={table}
                  text={sqlText}
                  onTextChange={setSqlText}
                  history={sqlHistory}
                  onRan={(sql) => setSqlHistory((h) => pushHistory(h, sql))}
                  onClose={() => setSqlOpen(false)}
                />
              )}
              <div className="flex min-h-0 flex-1">
                <aside className="flex w-56 shrink-0 flex-col border-r border-line">
                  <div className="flex items-center justify-between gap-2 border-b border-line/50 px-3 py-1 text-[10px] uppercase tracking-wider text-muted/70">
                    <span>tables · {formatRowCount(tables.length)}</span>
                    {tablesQ.isFetching && !tablesQ.isPending && (
                      <Loader2 size={10} className="shrink-0 animate-spin text-accent" />
                    )}
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
                          onClick={() => setTable(t.name)}
                          title={t.name}
                          className={clsx(
                            "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-surface-2",
                            table === t.name ? "bg-accent/10 text-accent" : "text-txt/90",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{t.name}</span>
                          <span className="shrink-0 text-[10px] tabular-nums text-muted/70">
                            {formatRowCount(t.row_count)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </aside>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1">
                    <div className="relative w-64">
                      <Search
                        size={12}
                        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted/70"
                      />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setSearch("");
                        }}
                        disabled={table == null}
                        placeholder="search rows"
                        title="Substring match across all columns (case-insensitive)"
                        className="h-7 w-full rounded-md border border-line bg-bg pl-6 pr-6 font-mono text-[11px] text-txt placeholder:text-muted/50 focus:border-accent focus:outline-none disabled:opacity-40"
                      />
                      {search !== "" && (
                        <button
                          type="button"
                          onClick={() => setSearch("")}
                          title="Clear search"
                          className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-muted/70 hover:text-txt"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                    {querySearch !== "" && (
                      <span className="font-mono text-[10px] text-muted/70">filter active</span>
                    )}
                  </div>
                  <div className="min-h-0 flex-1">
                    {table != null && rowsError != null ? (
                      <div className="p-3">
                        <ErrorBox message={rowsError} />
                      </div>
                    ) : table == null ? null : tablePage == null ? (
                      <div className="flex h-full items-center justify-center">
                        <Loader2 size={16} className="animate-spin text-accent" />
                      </div>
                    ) : tablePage.rows.length === 0 ? (
                      querySearch !== "" ? (
                        <EmptyState
                          title="No matching rows"
                          hint={`Nothing in ${table} contains “${querySearch}”`}
                        />
                      ) : (
                        <EmptyState
                          title="Table is empty"
                          hint={`No rows in ${table} · press Refresh after the app writes data`}
                        />
                      )
                    ) : (
                      <TableGrid
                        page={tablePage}
                        offsetBase={tablePage.offset}
                        order={order}
                        onSort={(col) => setOrder((cur) => nextOrderState(col, cur))}
                      />
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-3 py-1 text-[11px] text-muted">
                    <span className="font-mono">
                      {tablePage != null ? `${formatRowCount(tablePage.total_rows)} rows` : "…"}
                    </span>
                    {tablePage != null && totalPages > 0 && (
                      <>
                        <span className="text-muted/50">·</span>
                        <span className="font-mono">
                          {tablePage.offset + 1}–{tablePage.offset + tablePage.rows.length}
                        </span>
                        <span className="text-muted/50">·</span>
                        <span className="font-mono">
                          page {page + 1} of {totalPages}
                        </span>
                        <span className="flex overflow-hidden rounded-md border border-line">
                          <button
                            type="button"
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={page === 0}
                            title="Previous page"
                            className="flex h-6 w-6 items-center justify-center hover:bg-surface-2 hover:text-txt disabled:opacity-30"
                          >
                            <ChevronLeft size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                            disabled={page >= totalPages - 1}
                            title="Next page"
                            className="flex h-6 w-6 items-center justify-center border-l border-line hover:bg-surface-2 hover:text-txt disabled:opacity-30"
                          >
                            <ChevronRight size={11} />
                          </button>
                        </span>
                      </>
                    )}
                    <span className="ml-auto flex items-center gap-1.5">
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
                        className="flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-muted hover:text-txt disabled:opacity-40"
                      >
                        <RefreshCw size={11} className={pull.isPending ? "animate-spin" : ""} />{" "}
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={toggleSql}
                        title={
                          sqlOpen
                            ? "Hide the SQL console"
                            : "Open a read-only SQL console on this snapshot"
                        }
                        className={clsx(
                          "flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] hover:text-txt",
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
                        className="flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-muted hover:text-txt"
                      >
                        <FolderOpen size={11} /> Reveal
                      </button>
                      <button
                        type="button"
                        onClick={() => void onExport()}
                        disabled={exporting}
                        title="Copy the snapshot to a folder you pick"
                        className="flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-muted hover:text-txt disabled:opacity-40"
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
