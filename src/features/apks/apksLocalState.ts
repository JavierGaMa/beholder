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
