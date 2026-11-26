import type { HttpExchange } from "../../store/types";

export interface Filters {
  text: string;
  status: "all" | "2xx" | "3xx" | "4xx" | "5xx";
  method: string;
  failuresOnly: boolean;
  slowOnly: boolean;
  inBodies: boolean;
  includeDomains: string[];
  excludeDomains: string[];
  localOnly: boolean;
}

export function isFailed(ex: HttpExchange): boolean {
  if (ex.error != null) return true;
  const status = ex.response?.status ?? null;
  return status != null && status >= 400;
}

export type QuickMode = "all" | "errors" | "slow";

export function isSlow(ex: HttpExchange, slowMs: number): boolean {
  const total = ex.timing.total_ms;
  return total != null && total >= slowMs;
}

export function quickModeOf(f: Filters): QuickMode | "custom" {
  if (f.failuresOnly && f.slowOnly) return "custom";
  if (f.failuresOnly) return "errors";
  if (f.slowOnly) return "slow";
  return "all";
}

export function withQuickMode(f: Filters, mode: QuickMode): Filters {
  return { ...f, failuresOnly: mode === "errors", slowOnly: mode === "slow" };
}

export function quickCounts(exchanges: HttpExchange[], f: Filters, slowMs = 500): Record<QuickMode, number> {
  const scope = { ...f, failuresOnly: false, slowOnly: false };
  const counts = { all: 0, errors: 0, slow: 0 };
  for (const ex of exchanges) {
    if (!matchFilters(ex, scope, slowMs)) continue;
    counts.all++;
    if (isFailed(ex)) counts.errors++;
    if (isSlow(ex, slowMs)) counts.slow++;
  }
  return counts;
}

export function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.method) n++;
  if (f.status !== "all") n++;
  if (f.failuresOnly) n++;
  if (f.slowOnly) n++;
  if (f.inBodies) n++;
  if (f.includeDomains.length > 0) n++;
  if (f.excludeDomains.length > 0) n++;
  if (f.localOnly) n++;
  return n;
}

export function matchFilters(ex: HttpExchange, f: Filters, slowMs = 500): boolean {
  if (f.method && ex.request.method !== f.method.toUpperCase()) return false;
  const status = ex.response?.status ?? null;
  if (f.localOnly && !ex.request.routed) return false;
  if (f.failuresOnly && !isFailed(ex)) return false;
  if (f.slowOnly && !isSlow(ex, slowMs)) return false;
  if (f.status !== "all") {
    if (status == null) return false;
    if (`${Math.floor(status / 100)}xx` !== f.status) return false;
  }
  if (f.includeDomains.length > 0 && !f.includeDomains.includes(ex.request.host)) return false;
  if (f.excludeDomains.includes(ex.request.host)) return false;
  if (f.text) {
    const t = f.text.toLowerCase();
    const url = `${ex.request.host}${ex.request.path} ${ex.request.url}`.toLowerCase();
    if (url.includes(t)) return true;
    if (f.inBodies) {
      const reqBody = ex.request.body?.text?.toLowerCase() ?? "";
      const resBody = ex.response?.body?.text?.toLowerCase() ?? "";
      if (reqBody.includes(t) || resBody.includes(t)) return true;
    }
    return false;
  }
  return true;
}
