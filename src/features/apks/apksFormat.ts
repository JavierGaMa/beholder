import type { ApkEntry } from "../../store/types";

export type { ApkEntry };

export type EnvFilter = "all" | "QA" | "PROD";

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function filterApks(entries: ApkEntry[], query: string, env: EnvFilter): ApkEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (env !== "all" && e.env !== env) return false;
    if (!q) return true;
    return e.name.toLowerCase().includes(q);
  });
}

export function downloadPct(received: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((received / total) * 100));
}
