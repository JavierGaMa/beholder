import { create } from "zustand";
import { invoke } from "../lib/tauri";
import { errorText, isFresh, type CachedStatus } from "./cached";
import type { ApkEntry } from "./types";

export const APKS_TTL_MS = 60_000;

interface ApksState {
  entries: ApkEntry[];
  status: CachedStatus;
  error: string | null;
  refreshing: boolean;
  lastFetched: number | null;
  configured: boolean;
  setConfigured: (value: boolean) => void;
  refresh: (force?: boolean) => Promise<void>;
}

let inFlight: Promise<void> | null = null;

export const useApks = create<ApksState>((set, get) => ({
  entries: [],
  status: "idle",
  error: null,
  refreshing: false,
  lastFetched: null,
  configured: false,
  setConfigured: (value) => {
    if (get().configured === value) return;
    set({
      configured: value,
      entries: [],
      status: "idle",
      error: null,
      refreshing: false,
      lastFetched: null,
    });
  },
  refresh: (force = false) => {
    if (inFlight) return inFlight;
    if (!get().configured) {
      set({ entries: [], status: "idle", error: null, refreshing: false });
      return Promise.resolve();
    }
    const { status, lastFetched } = get();
    if (!force && status === "ready" && isFresh(lastFetched, APKS_TTL_MS)) {
      return Promise.resolve();
    }
    if (lastFetched == null) {
      set({ status: "loading", error: null });
    } else {
      set({ refreshing: true });
    }
    inFlight = (async () => {
      try {
        const list = await invoke<ApkEntry[]>("list_apks");
        set({
          entries: Array.isArray(list) ? list : [],
          status: "ready",
          error: null,
          refreshing: false,
          lastFetched: Date.now(),
        });
      } catch (e) {
        const patch: Partial<ApksState> = { error: errorText(e), refreshing: false };
        if (get().lastFetched == null) patch.status = "error";
        set(patch);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },
}));
