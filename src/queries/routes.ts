import { useEffect } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/tauri";
import { toast } from "../components/ui/toast";
import { useTraffic } from "../store/traffic";
import { useRoutes } from "../features/routes/store";
import { summarizeRoutes } from "../features/routes/routes";
import type { RouteFileStatus, RouteHealth } from "../store/types";

export const ROUTES_HEALTH_INTERVAL_MS = 5000;

const NO_PATHS: string[] = [];
const NO_FILES: RouteFileStatus[] = [];
const NO_HEALTH: Record<string, RouteHealth> = {};

export function routesQueryKey(paths: string[]) {
  return ["routes", paths] as const;
}

export function routesHealthQueryKey(files: RouteFileStatus[]) {
  return ["routes-health", files.flatMap((f) => f.routes.map((r) => `${r.key} ${r.target}`))] as const;
}

function useConfiguredPaths(): string[] {
  return useTraffic((s) => s.uiConfig?.routes?.files) ?? NO_PATHS;
}

export function useRoutesStatus() {
  const paths = useConfiguredPaths();
  const query = useQuery({
    queryKey: routesQueryKey(paths),
    queryFn: () => invoke<RouteFileStatus[]>("list_routes"),
    placeholderData: keepPreviousData,
    retry: 0,
  });
  const files = query.data ?? NO_FILES;
  const enabled = useRoutes((s) => s.enabled);
  const reconcile = useRoutes((s) => s.reconcile);
  useEffect(() => {
    reconcile(files);
  }, [files, enabled, reconcile]);
  const visible = useTraffic((s) => s.activeView === "routes");
  const poll = files.some((f) => f.routes.length > 0) &&
    (visible || summarizeRoutes(files, enabled, NO_HEALTH).enabled > 0);
  const health =
    useQuery({
      queryKey: routesHealthQueryKey(files),
      queryFn: () => invoke<Record<string, RouteHealth>>("routes_health"),
      enabled: poll,
      refetchInterval: ROUTES_HEALTH_INTERVAL_MS,
      staleTime: ROUTES_HEALTH_INTERVAL_MS - 1000,
      placeholderData: keepPreviousData,
      retry: 0,
    }).data ?? NO_HEALTH;
  return { query, files, enabled, health, summary: summarizeRoutes(files, enabled, health) };
}

export function useReloadRoutes() {
  const paths = useConfiguredPaths();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<RouteFileStatus[]>("reload_routes"),
    onSuccess: (files) => {
      client.setQueryData(routesQueryKey(paths), files);
      void client.invalidateQueries({ queryKey: ["routes-health"] });
    },
    onError: (e) => toast(`Could not reload routes: ${String(e)}`, "danger"),
  });
}

export function useRefreshRoutesOnCapture() {
  const client = useQueryClient();
  const captureOn = useTraffic((s) => s.captureOn);
  const capturePort = useTraffic((s) => s.capturePort);
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ["routes"] });
  }, [client, captureOn, capturePort]);
}
