import { create } from "zustand";
import { invoke } from "../lib/tauri";
import type { AppFilter, ConsoleColumns, ConsoleEntry, ConsoleEvent, LogFilter, LogLevel, LogLine, LogStatus, PaneMode } from "./console-types";
import { useTraffic } from "./traffic";

export interface ConsoleState {
  lines: ConsoleEntry[];
  status: LogStatus;
  paused: boolean;
  pausedDropCount: number;
  minLevel: LogLevel | null;
  tagQuery: string;
  regex: string;
  regexError: string | null;
  columns: ConsoleColumns;
  observedTags: string[];
  serial: string | null;
  running: boolean;
  appFilter: AppFilter | null;
  paneMode: PaneMode;
  setPaneMode: (mode: PaneMode) => void;
  shellOpen: boolean;
  toggleShell: () => void;
  setShellOpen: (open: boolean) => void;
  setPaused: (paused: boolean) => void;
  clear: () => void;
  setMinLevel: (level: LogLevel | null) => void;
  setTagQuery: (q: string) => void;
  setRegex: (r: string) => void;
  setColumns: (patch: Partial<ConsoleColumns>) => void;
  setAppFilter: (app: AppFilter | null) => void;
  start: (serial: string, buffers: string[]) => void;
  stop: () => void;
  ingest: (events: ConsoleEvent[]) => void;
}

export const DEFAULT_RING_LINES = 10000;

function pushFilter() {
  const { appFilter } = useConsole.getState();
  const filter: LogFilter = {
    pid: appFilter?.pid ?? null,
    min_level: null,
    tags: [],
  };
  invoke("console_set_filter", { filter }).catch(() => {});
}

function ringCap(): number {
  return useTraffic.getState().uiConfig?.console?.ring_lines ?? DEFAULT_RING_LINES;
}

export const useConsole = create<ConsoleState>((set) => ({
  lines: [],
  status: "Stopped",
  paused: false,
  pausedDropCount: 0,
  minLevel: null,
  tagQuery: "",
  regex: "",
  regexError: null,
  columns: { time: false, level: true, tag: false, pid: false, tid: false },
  observedTags: [],
  serial: null,
  running: false,
  appFilter: null,
  paneMode: "logs",
  setPaneMode: (mode) => set({ paneMode: mode }),
  shellOpen: false,
  toggleShell: () => set((s) => ({ shellOpen: !s.shellOpen })),
  setShellOpen: (open) => set({ shellOpen: open }),
  setPaused: (paused) =>
    set((s) => {
      if (paused === s.paused) return s;
      if (!paused && s.pausedDropCount > 0) {
        return {
          paused,
          lines: [...s.lines, { kind: "gap", dropped: s.pausedDropCount }],
          pausedDropCount: 0,
        };
      }
      return { paused, pausedDropCount: 0 };
    }),
  clear: () => set({ lines: [], pausedDropCount: 0 }),
  setMinLevel: (level) => {
    set({ minLevel: level });
  },
  setTagQuery: (q) => {
    set({ tagQuery: q });
  },
  setRegex: (r) => {
    let regexError: string | null = null;
    if (r.length > 0) {
      try {
        new RegExp(r);
      } catch (e) {
        regexError = e instanceof Error ? e.message : String(e);
      }
    }
    set({ regex: r, regexError });
  },
  setColumns: (patch) => set((s) => ({ columns: { ...s.columns, ...patch } })),
  setAppFilter: (app) => {
    set({ appFilter: app });
    pushFilter();
  },
  start: (serial, buffers) => {
    set({ serial });
    invoke("console_start", { serial, buffers }).catch(() => {});
  },
  stop: () => {
    invoke("console_stop").catch(() => {});
  },
  ingest: (events) =>
    set((s) => {
      let status = s.status;
      let running = s.running;
      const appended: LogLine[] = [];
      let dropped = 0;
      for (const ev of events) {
        if ("Status" in ev) {
          status = ev.Status;
          running = ev.Status === "Streaming";
        } else if ("Line" in ev) {
          if (s.paused) dropped += 1;
          else appended.push(ev.Line);
        }
      }
      if (status === s.status && dropped === 0 && appended.length === 0) return s;
      if (s.paused) {
        return { status, running, pausedDropCount: s.pausedDropCount + dropped };
      }
      let lines = s.lines;
      if (appended.length > 0) {
        lines = s.lines.concat(appended);
        const cap = ringCap();
        if (lines.length > cap) lines = lines.slice(lines.length - cap);
      }
      let observedTags = s.observedTags;
      if (appended.length > 0) {
        const seen = new Set(s.observedTags);
        const next = s.observedTags.slice();
        let changed = false;
        for (const l of appended) {
          if (l.tag && !seen.has(l.tag)) {
            seen.add(l.tag);
            next.push(l.tag);
            changed = true;
          }
        }
        if (changed) observedTags = next;
      }
      return { status, running, lines, observedTags };
    }),
}));
