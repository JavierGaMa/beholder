import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/tauri";
import type { HostCheckT } from "../features/setup/fixPlan";

export const HOST_DOCTOR_STALE_MS = 15_000;

export function useHostDoctorQuery() {
  return useQuery({
    queryKey: ["host-doctor"],
    queryFn: () => invoke<HostCheckT[]>("run_host_doctor"),
    staleTime: HOST_DOCTOR_STALE_MS,
    retry: 0,
  });
}

export function useInvalidateHostDoctor() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["host-doctor"] });
}
