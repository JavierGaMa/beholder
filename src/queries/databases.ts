import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/tauri";
import type { AppProcess } from "../store/console-types";

export interface DbFile {
  name: string;
  size_bytes: number;
  has_wal: boolean;
}

export interface SnapshotInfo {
  local_path: string;
  size_bytes: number;
  pulled_at_epoch_ms: number;
}

export interface TableSummary {
  name: string;
  row_count: number;
}

export interface TableColumn {
  name: string;
  decl_type: string | null;
}

export interface TablePage {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  total_rows: number;
  offset: number;
  limit: number;
}

export type OrderDir = "asc" | "desc";

export interface TableOrder {
  col: string;
  dir: OrderDir;
}

export const DATABASES_STALE_MS = 30_000;

export function useAppPackagesQuery(serial: string, enabled: boolean) {
  return useQuery({
    queryKey: ["console-apps", serial],
    queryFn: () => invoke<AppProcess[]>("console_apps", { serial }),
    enabled,
    staleTime: DATABASES_STALE_MS,
  });
}

export function useAppDatabasesQuery(serial: string, pkg: string, enabled: boolean) {
  return useQuery({
    queryKey: ["app-databases", serial, pkg],
    queryFn: () => invoke<DbFile[]>("list_app_databases", { serial, package: pkg }),
    enabled,
    staleTime: DATABASES_STALE_MS,
  });
}

export function useDatabaseTablesQuery(
  serial: string,
  pkg: string,
  dbName: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["db-tables", serial, pkg, dbName],
    queryFn: () => invoke<TableSummary[]>("database_tables", { serial, package: pkg, dbName }),
    enabled,
    staleTime: DATABASES_STALE_MS,
  });
}

export function useTableRowsQuery(
  serial: string,
  pkg: string,
  dbName: string,
  table: string,
  page: number,
  pageSize: number,
  search: string,
  order: TableOrder | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      "db-rows",
      serial,
      pkg,
      dbName,
      table,
      page,
      search,
      order?.col ?? null,
      order?.dir ?? null,
    ],
    queryFn: () =>
      invoke<TablePage>("database_table_rows", {
        serial,
        package: pkg,
        dbName,
        table,
        page,
        pageSize,
        search: search === "" ? undefined : search,
        orderBy: order?.col,
        orderDir: order?.dir,
      }),
    enabled,
    staleTime: DATABASES_STALE_MS,
  });
}

export function usePullSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serial: string; pkg: string; dbName: string }) =>
      invoke<SnapshotInfo>("pull_database_snapshot", {
        serial: vars.serial,
        package: vars.pkg,
        dbName: vars.dbName,
      }),
    onSuccess: (_info, vars) => {
      void queryClient.invalidateQueries({
        queryKey: ["app-databases", vars.serial, vars.pkg],
      });
      void queryClient.invalidateQueries({
        queryKey: ["db-tables", vars.serial, vars.pkg, vars.dbName],
      });
      void queryClient.invalidateQueries({
        queryKey: ["db-rows", vars.serial, vars.pkg, vars.dbName],
      });
    },
  });
}

export function useInvalidateDatabases(serial: string, pkg: string | null) {
  const queryClient = useQueryClient();
  return () => {
    const targets = [queryClient.invalidateQueries({ queryKey: ["console-apps", serial] })];
    if (pkg != null) {
      targets.push(
        queryClient.invalidateQueries({ queryKey: ["app-databases", serial, pkg] }),
      );
    }
    return Promise.all(targets);
  };
}
