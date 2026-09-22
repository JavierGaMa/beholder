import { create } from "zustand";
import type { HttpExchange, TrafficEvent, WsEvent } from "./types";
import type { UiConfig } from "../lib/theme/config-types";

export const MAX_EXCHANGES = 2000;
export const MAX_WS_FRAMES = 500;

export type View = "requests" | "websockets" | "emulators" | "apks" | "console" | "database";

export interface MetroStatus {
  detected: boolean;
  port: number;
}

export interface OnboardingTarget {
  avdName: string;
  createdNew: boolean;
}

export interface WsFrame {
  seq: number;
  direction: "Sent" | "Received";
  payload: { text: string; is_binary: boolean; size: number; truncated: boolean; mime: string | null };
  at: number;
}

export interface WsConnection {
  id: number;
  url: string;
  openedAt: number;
  closed: boolean;
  frames: WsFrame[];
}

interface TrafficState {
  exchanges: Map<number, HttpExchange>;
  order: number[];
  wsConnections: Map<number, WsConnection>;
  seen: Set<number>;
  activeView: View;
  captureOn: boolean;
  capturePort: number | null;
  metro: MetroStatus | null;
  requestCount: number;
  installLog: string | null;
  uiConfig: UiConfig | null;
  settingsOpen: boolean;
  setupOpen: boolean;
  targetSerial: string | null;
  targetAvd: string | null;
  onboarding: OnboardingTarget | null;
  pendingSelectId: number | null;
  requestSelect: (id: number) => void;
  setPendingSelectId: (id: number | null) => void;
  setActiveView: (v: View) => void;
  setCapture: (on: boolean, port?: number | null) => void;
  setMetro: (m: MetroStatus | null) => void;
  ingest: (events: TrafficEvent[]) => void;
  clear: () => void;
  setInstallLog: (line: string | null) => void;
  setUiConfig: (c: UiConfig) => void;
  setSettingsOpen: (open: boolean) => void;
  setSetupOpen: (open: boolean) => void;
  setTarget: (serial: string | null, avd: string | null) => void;
  setOnboarding: (t: OnboardingTarget | null) => void;
}

export const useTraffic = create<TrafficState>((set) => ({
  exchanges: new Map(),
  order: [],
  wsConnections: new Map(),
  seen: new Set(),
  activeView: "requests",
  captureOn: false,
  capturePort: null,
  metro: null,
  requestCount: 0,
  installLog: null,
  uiConfig: null,
  settingsOpen: false,
  setupOpen: false,
  targetSerial: null,
  targetAvd: null,
  onboarding: null,
  pendingSelectId: null,
  requestSelect: (id) => set({ pendingSelectId: id, activeView: "requests" }),
  setPendingSelectId: (id) => set({ pendingSelectId: id }),
  setActiveView: (v) => set({ activeView: v }),
  setCapture: (on, port = null) =>
    set((s) => ({ captureOn: on, capturePort: on ? port : null, metro: on ? s.metro : null })),
  setMetro: (m) => set({ metro: m }),
  setInstallLog: (line) => set({ installLog: line }),
  setUiConfig: (c) => set({ uiConfig: c }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSetupOpen: (open) => set({ setupOpen: open }),
  setTarget: (serial, avd) => set({ targetSerial: serial, targetAvd: avd }),
  setOnboarding: (t) => set({ onboarding: t }),
  clear: () =>
    set({
      exchanges: new Map(),
      order: [],
      wsConnections: new Map(),
      seen: new Set(),
      requestCount: 0,
    }),
  ingest: (events) =>
    set((s) => {
      let exchanges = s.exchanges;
      let order = s.order;
      let orderChanged = false;
      let wsConnections = s.wsConnections;
      let count = s.requestCount;
      const seen = s.seen;
      for (const ev of events) {
        switch (ev.type) {
          case "ExchangeStarted": {
            if (exchanges === s.exchanges) exchanges = new Map(s.exchanges);
            exchanges.set(ev.id, {
              id: ev.id,
              request: ev.request,
              response: null,
              error: null,
              timing: { ttfb_ms: null, download_ms: null, total_ms: null },
              protocol: "",
            });
            if (!seen.has(ev.id)) {
              if (!orderChanged) {
                order = [...s.order];
                orderChanged = true;
              }
              seen.add(ev.id);
              order.push(ev.id);
            }
            count += 1;
            break;
          }
          case "ExchangeCompleted": {
            const ex = exchanges.get(ev.id);
            if (ex) {
              if (exchanges === s.exchanges) exchanges = new Map(s.exchanges);
              exchanges.set(ev.id, {
                ...ex,
                response: ev.response,
                timing: ev.timing,
                protocol: ev.protocol,
              });
            }
            break;
          }
          case "ExchangeFailed": {
            const ex = exchanges.get(ev.id);
            if (ex) {
              if (exchanges === s.exchanges) exchanges = new Map(s.exchanges);
              exchanges.set(ev.id, { ...ex, error: ev.error });
            }
            break;
          }
          case "Ws": {
            if (wsConnections === s.wsConnections) wsConnections = new Map(s.wsConnections);
            applyWs(wsConnections, ev);
            break;
          }
        }
      }
      if (orderChanged) {
        while (order.length > MAX_EXCHANGES) {
          const id = order.shift();
          if (id == null) break;
          exchanges.delete(id);
          seen.delete(id);
        }
      }
      if (exchanges === s.exchanges && !orderChanged && wsConnections === s.wsConnections && count === s.requestCount) {
        return s;
      }
      return { exchanges, order, wsConnections, requestCount: count };
    }),
}));

function applyWs(map: Map<number, WsConnection>, ev: WsEvent) {
  switch (ev.kind) {
    case "Opened":
      map.set(ev.id, { id: ev.id, url: ev.url, openedAt: ev.opened_at, closed: false, frames: [] });
      break;
    case "Frame": {
      const conn =
        map.get(ev.id) ?? { id: ev.id, url: "(unknown)", openedAt: ev.at, closed: false, frames: [] };
      conn.frames.push({
        seq: ev.seq,
        direction: ev.direction,
        payload: ev.payload,
        at: ev.at,
      });
      if (conn.frames.length > MAX_WS_FRAMES) {
        conn.frames.splice(0, conn.frames.length - MAX_WS_FRAMES);
      }
      map.set(ev.id, conn);
      break;
    }
    case "Closed": {
      const conn = map.get(ev.id);
      if (conn) map.set(ev.id, { ...conn, closed: true });
      break;
    }
  }
}
