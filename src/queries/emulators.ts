import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/tauri";
import type { AvdInfo, SystemImage } from "../store/types";

export const AVDS_STALE_MS = 30_000;

export function useAvdsQuery() {
  return useQuery({
    queryKey: ["avds"],
    queryFn: () => invoke<AvdInfo[]>("list_avds"),
    staleTime: AVDS_STALE_MS,
  });
}

export function useImagesQuery() {
  return useQuery({
    queryKey: ["images"],
    queryFn: () => invoke<SystemImage[]>("list_images"),
    staleTime: 60_000,
  });
}

export function useProfilesQuery() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: () => invoke<string[]>("list_device_profiles"),
    staleTime: 60_000,
  });
}

export function useInvalidateEmulators() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["avds"] }),
      queryClient.invalidateQueries({ queryKey: ["images"] }),
      queryClient.invalidateQueries({ queryKey: ["profiles"] }),
    ]);
}
