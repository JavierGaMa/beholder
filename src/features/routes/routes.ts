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
