import { useQuery } from "@tanstack/react-query";
import { invoke } from "../lib/tauri";
import type { ApkEntry } from "../store/types";

export const APKS_STALE_MS = 60_000;

export function useApksQuery(listUrl: string, enabled: boolean) {
  return useQuery({
    queryKey: ["apks", listUrl],
    queryFn: () => invoke<ApkEntry[]>("list_apks"),
    enabled,
    staleTime: APKS_STALE_MS,
  });
}

export function useApksDirQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["apks-dir"],
    queryFn: () => invoke<{ dir: string }>("apks_download_dir"),
    enabled,
    retry: false,
  });
}
