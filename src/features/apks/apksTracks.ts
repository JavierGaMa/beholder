import type { ApkEntry } from "../../store/types";

export function normalizedEnv(env: string | null | undefined): string {
  return env?.toUpperCase() || "UNKNOWN";
}

export function normalizedFlavor(flavor: string | null | undefined): string {
  return flavor?.trim() || "default";
}

export function sortByLastModifiedDesc(entries: ApkEntry[]): ApkEntry[] {
  const stamped = entries.map((entry, index) => {
    const at = new Date(entry.last_modified).getTime();
    return { entry, index, at: Number.isFinite(at) ? at : null };
  });
  stamped.sort((a, b) => {
    if (a.at == null || b.at == null) {
      if (a.at != null) return -1;
      if (b.at != null) return 1;
      return a.index - b.index;
    }
    if (a.at !== b.at) return b.at - a.at;
    return a.index - b.index;
  });
  return stamped.map((s) => s.entry);
}

export function formatRelativeLastModified(lastModified: string, now: number): string {
  const at = new Date(lastModified).getTime();
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(at).toISOString().slice(0, 10);
}
