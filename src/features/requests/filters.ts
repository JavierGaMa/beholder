import type { HttpExchange } from "../../store/types";

export interface Filters {
  text: string;
  status: "all" | "2xx" | "3xx" | "4xx" | "5xx";
  method: string;
}

export function matchFilters(ex: HttpExchange, f: Filters): boolean {
  if (f.method && ex.request.method !== f.method.toUpperCase()) return false;
  const status = ex.response?.status ?? null;
  if (f.status !== "all") {
    if (status == null) return false;
    const cls = Math.floor(status / 100);
    if (`${cls}xx` !== f.status) return false;
  }
  if (f.text) {
    const t = f.text.toLowerCase();
    const hay = `${ex.request.host}${ex.request.path} ${ex.request.url}`.toLowerCase();
    if (!hay.includes(t)) return false;
  }
  return true;
}
