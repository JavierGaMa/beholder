import type { ApkEntry } from "../../store/types";

export type DownloadPhase =
  | { phase: "idle" }
  | { phase: "downloading"; received: number; total: number }
  | { phase: "installing" }
  | { phase: "done" }
  | { phase: "error"; message: string };

export function localFileName(blobName: string): string {
  const last = blobName.replace(/\/+$/, "").split("/").pop() ?? "";
  return last === "." || last === ".." ? "" : last;
}

export function applyDownloadProgress(
  rows: Record<string, DownloadPhase>,
  payload: { name: string; received: number; total: number },
): Record<string, DownloadPhase> {
  const row = rows[payload.name];
  if (!row || row.phase !== "downloading") return rows;
  return {
    ...rows,
    [payload.name]: {
      phase: "downloading",
      received: payload.received,
      total: payload.total,
    },
  };
}

export function effectiveDirLabel(
  configuredRaw: string | null | undefined,
  resolved: string | null | undefined,
): string {
  if (resolved != null && resolved !== "") return resolved;
  if (configuredRaw != null && configuredRaw !== "") return configuredRaw;
  return "";
}

export interface LocalApk {
  name: string;
  size_bytes: number;
  path: string;
}

export function matchLocalFiles(
  entries: ApkEntry[],
  local: LocalApk[],
): Record<string, LocalApk> {
  const byName = new Map(local.map((file) => [file.name, file]));
  const matches: Record<string, LocalApk> = {};
  for (const entry of entries) {
    const key = localFileName(entry.name);
    const match = key === "" ? undefined : byName.get(key);
    if (match) matches[key] = match;
  }
  return matches;
}
