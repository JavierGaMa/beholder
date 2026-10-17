import { useMutation } from "@tanstack/react-query";
import { invoke } from "../lib/tauri";

export interface FlavorApplicationId {
  flavor: string;
  suffix: string | null;
  effective: string | null;
}

export interface RnVariantsInfo {
  projectRoot: string;
  gradleFile: string;
  flavors: string[];
  buildTypes: string[];
  applicationId: string | null;
  flavorIds: FlavorApplicationId[];
  duplicateIds: string[];
}

export interface MetroRunInfo {
  port: number;
  running: boolean;
  spawned: boolean;
}

export function useRnVariantsMutation() {
  return useMutation({
    mutationFn: (vars: { path: string }) =>
      invoke<RnVariantsInfo>("list_rn_variants", { path: vars.path }),
  });
}

export function useBuildAndRunMutation() {
  return useMutation({
    mutationFn: (vars: {
      projectPath: string;
      flavor: string | null;
      buildType: string;
      serial: string;
    }) => invoke<void>("build_and_run", vars),
  });
}

export function useMetroStartMutation() {
  return useMutation({
    mutationFn: (vars: { projectPath: string }) =>
      invoke<MetroRunInfo>("metro_start", vars),
  });
}

export function useMetroStopMutation() {
  return useMutation({
    mutationFn: () => invoke<void>("metro_stop"),
  });
}

export function useForceStopAppMutation() {
  return useMutation({
    mutationFn: (vars: { serial: string; package: string }) =>
      invoke<void>("force_stop_app", vars),
  });
}
