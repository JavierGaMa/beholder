import { useQuery } from "@tanstack/react-query";
import { invoke } from "../lib/tauri";
import type { Device, DeviceReport } from "../store/types";

export function useDeviceProbeQuery(serial: string, online: boolean) {
  return useQuery({
    queryKey: ["device-probe", serial],
    queryFn: () => invoke<DeviceReport>("probe_device", { serial }),
    enabled: online,
    retry: 0,
    staleTime: 0,
  });
}

export function useWatchedDevicesQuery() {
  return useQuery({
    queryKey: ["adb-devices"],
    queryFn: () => invoke<Device[]>("list_devices"),
    refetchInterval: 3000,
  });
}
