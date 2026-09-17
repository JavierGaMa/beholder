import { useQuery } from "@tanstack/react-query";
import { invoke, isTauri } from "../lib/tauri";

export type CaptureCheckT = {
  id: string;
  title: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix: string | null;
};

export function useCaptureHealthQuery(captureOn: boolean) {
  return useQuery({
    queryKey: ["capture-health"],
    queryFn: () => invoke<CaptureCheckT[]>("capture_health"),
    enabled: isTauri && captureOn,
    refetchInterval: 5000,
    staleTime: 4000,
    retry: 0,
  });
}
