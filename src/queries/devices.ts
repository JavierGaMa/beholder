import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/tauri";
import type { Device } from "../store/types";

export const DEVICES_STALE_MS = 30_000;

export function useAdbDevicesQuery() {
  return useQuery({
    queryKey: ["adb-devices"],
    queryFn: () => invoke<Device[]>("list_devices"),
    staleTime: DEVICES_STALE_MS,
  });
}

export function useInvalidateDevices() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["adb-devices"] }),
      queryClient.invalidateQueries({ queryKey: ["avds"] }),
    ]);
}
