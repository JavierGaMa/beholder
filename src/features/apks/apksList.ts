import { downloadPct, filterApks, type ApkEntry } from "./apksFormat";
import type { DownloadPhase } from "./apksLocalState";

export interface EnvCounts {
  all: number;
  QA: number;
  PROD: number;
}

export function envCounts(entries: ApkEntry[], query: string): EnvCounts {
  return {
    all: filterApks(entries, query, "all").length,
    QA: filterApks(entries, query, "QA").length,
    PROD: filterApks(entries, query, "PROD").length,
  };
}

export type RowAction =
  | { kind: "progress"; pct: number }
  | { kind: "installing" }
  | { kind: "installed" }
  | { kind: "retry"; message: string }
  | { kind: "install" };

export function rowAction(state: DownloadPhase): RowAction {
  switch (state.phase) {
    case "downloading":
      return { kind: "progress", pct: downloadPct(state.received, state.total) };
    case "installing":
      return { kind: "installing" };
    case "done":
      return { kind: "installed" };
    case "error":
      return { kind: "retry", message: state.message };
    default:
      return { kind: "install" };
  }
}
