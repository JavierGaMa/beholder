import type { RouteFileStatus, RouteHealth } from "../../store/types";

export type RoutePill = "healthy" | "unreachable" | "checking" | "off";

export const CONFIG_SNIPPET = '[routes]\nfiles = ["/abs/path/routes.json"]\n';

export function summarizeRoutes(
  files: RouteFileStatus[],
  enabled: string[],
  health: Record<string, RouteHealth>,
): { total: number; enabled: number; unreachable: number } {
  const keys = files.flatMap((f) => f.routes.map((r) => r.key));
  const active = keys.filter((key) => enabled.includes(key));
  return {
    total: keys.length,
    enabled: active.length,
    unreachable: active.filter((key) => health[key] === "down").length,
  };
}

export function routePill(isEnabled: boolean, health: RouteHealth | undefined): RoutePill {
  if (!isEnabled) return "off";
  if (health === "up") return "healthy";
  if (health === "down") return "unreachable";
  return "checking";
}

export function hitKey(routeId: string, target: string): string {
  return `${routeId}\n${target.replace(/\/$/, "")}`;
}

export function totalHits(hits: Map<string, number>): number {
  let total = 0;
  for (const count of hits.values()) total += count;
  return total;
}

export function withRoutesEnabled(current: string[], keys: string[], on: boolean): string[] {
  const rest = current.filter((key) => !keys.includes(key));
  return on ? [...rest, ...keys] : rest;
}

export function enableRoutes(
  current: string[],
  files: RouteFileStatus[],
  keys: string[],
  onConflict: "replace" | "keep" = "replace",
): string[] {
  const matches = new Map(
    files.flatMap((f) =>
      f.routes.map((r) => [r.key, `${r.host ?? ""}\n${r.path_prefix}`.toLowerCase()] as const),
    ),
  );
  let next = current;
  for (const key of keys) {
    const match = matches.get(key);
    const rivals = next.filter((k) => k !== key && match !== undefined && matches.get(k) === match);
    if (onConflict === "keep" && rivals.length > 0) continue;
    next = next.filter((k) => !rivals.includes(k));
    if (!next.includes(key)) next = [...next, key];
  }
  return next;
}
