import { create } from "zustand";
import { invoke } from "../lib/tauri";
import { errorText, isFresh, type CachedStatus } from "./cached";
import type { AvdInfo, Device } from "./types";

export const DEVICES_TTL_MS = 30_000;

interface DevicesState {
  devices: Device[];
  avds: AvdInfo[];
  status: CachedStatus;
  error: string | null;
  refreshing: boolean;
  lastFetched: number | null;
  refresh: (force?: boolean) => Promise<void>;
}

let inFlight: Promise<void> | null = null;

export const useDevices = create<DevicesState>((set, get) => ({
  devices: [],
  avds: [],
  status: "idle",
  error: null,
  refreshing: false,
  lastFetched: null,
  refresh: (force = false) => {
    if (inFlight) return inFlight;
    const { status, lastFetched } = get();
    if (!force && status === "ready" && isFresh(lastFetched, DEVICES_TTL_MS)) {
      return Promise.resolve();
    }
    if (lastFetched == null) {
      set({ status: "loading", error: null });
    } else {
      set({ refreshing: true });
    }
    inFlight = (async () => {
      try {
        const [devices, avds] = await Promise.all([
          invoke<Device[]>("list_devices"),
          invoke<AvdInfo[]>("list_avds"),
        ]);
        set({
          devices: Array.isArray(devices) ? devices : [],
          avds: Array.isArray(avds) ? avds : [],
          status: "ready",
          error: null,
          refreshing: false,
          lastFetched: Date.now(),
        });
      } catch (e) {
        const patch: Partial<DevicesState> = { error: errorText(e), refreshing: false };
        if (get().lastFetched == null) patch.status = "error";
        set(patch);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },
}));
