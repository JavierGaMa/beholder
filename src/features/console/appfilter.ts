import type { AppProcess } from "../../store/console-types";

export interface AppFilterSnapshot {
  package: string;
  pid: number;
  missed: number;
}

export type AppFilterOutcome =
  | { action: "keep"; missed: number }
  | { action: "update"; pid: number; missed: number }
  | { action: "clear"; missed: number };

export function resolveAppFilter(snapshot: AppFilterSnapshot, apps: AppProcess[]): AppFilterOutcome {
  const found = apps.find((a) => a.package === snapshot.package);
  const pid = found?.pid ?? null;
  if (pid == null) {
    const missed = snapshot.missed + 1;
    if (missed >= 2) return { action: "clear", missed: 0 };
    return { action: "keep", missed };
  }
  if (pid !== snapshot.pid) return { action: "update", pid, missed: 0 };
  return { action: "keep", missed: 0 };
}
