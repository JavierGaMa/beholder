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
}

export function isFailed(ex: HttpExchange): boolean {
  if (ex.error != null) return true;
  const status = ex.response?.status ?? null;
  return status != null && status >= 400;
}

export function matchFilters(ex: HttpExchange, f: Filters, slowMs = 500): boolean {
  if (f.method && ex.request.method !== f.method.toUpperCase()) return false;
  const status = ex.response?.status ?? null;
  if (f.failuresOnly && !isFailed(ex)) return false;
  const total = ex.timing.total_ms;
  if (f.slowOnly && (total == null || total < slowMs)) return false;
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
