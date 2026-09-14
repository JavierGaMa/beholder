import { useEffect } from "react";
import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "../../lib/tauri";
import { downloadPct } from "./updaterFormat";

export type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; version: string; currentVersion: string; notes: string | null }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "installing"; version: string }
  | { kind: "error"; message: string };

interface UpdaterState {
  status: UpdaterStatus;
  dismissed: boolean;
}

const useUpdaterStore = create<UpdaterState>(() => ({
  status: { kind: "idle" },
  dismissed: false,
}));

let pendingUpdate: Update | null = null;
let autoCheckStarted = false;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function runCheck(silent: boolean): Promise<void> {
  if (!isTauri) return;
  useUpdaterStore.setState({ status: { kind: "checking" } });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      pendingUpdate = update;
      const status: UpdaterStatus = {
        kind: "available",
        version: update.version,
        currentVersion: update.currentVersion,
        notes: update.body ?? null,
      };
      useUpdaterStore.setState(
        silent ? { status } : { status, dismissed: false },
      );
    } else {
      pendingUpdate = null;
      useUpdaterStore.setState({ status: { kind: "uptodate" } });
    }
  } catch (e) {
    if (silent) {
      console.debug("update check failed", e);
      useUpdaterStore.setState({ status: { kind: "idle" } });
    } else {
      useUpdaterStore.setState({ status: { kind: "error", message: message(e) } });
    }
  }
}

async function installUpdate(): Promise<void> {
  if (!isTauri) return;
  const phase = useUpdaterStore.getState().status.kind;
  if (phase === "downloading" || phase === "installing") return;
  const update = pendingUpdate;
  if (!update) return;
  const version = update.version;
  let total: number | null = null;
  let downloaded = 0;
  try {
    useUpdaterStore.setState({ status: { kind: "downloading", version, percent: 0 } });
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (useUpdaterStore.getState().status.kind === "downloading") {
          useUpdaterStore.setState({
            status: { kind: "downloading", version, percent: downloadPct(downloaded, total) },
          });
        }
      }
    });
    useUpdaterStore.setState({ status: { kind: "installing", version } });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    useUpdaterStore.setState({ status: { kind: "error", message: message(e) } });
  }
}

export function useUpdater() {
  const status = useUpdaterStore((s) => s.status);
  const dismissed = useUpdaterStore((s) => s.dismissed);

  useEffect(() => {
    if (!isTauri || autoCheckStarted) return;
    autoCheckStarted = true;
    const timer = setTimeout(() => void runCheck(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  return {
    status,
    dismissed,
    checkForUpdates: () => void runCheck(false),
    installUpdate: () => void installUpdate(),
    dismiss: () => useUpdaterStore.setState({ dismissed: true }),
  };
}
