import { create } from "zustand";
import type { HttpExchange, TrafficEvent, WsEvent } from "./types";

export type View = "requests" | "websockets" | "emulators";

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
  activeView: View;
  captureOn: boolean;
  capturePort: number | null;
  requestCount: number;
  installLog: string | null;
  settingsOpen: boolean;
  targetSerial: string | null;
  targetAvd: string | null;
  onboarding: OnboardingTarget | null;
  setActiveView: (v: View) => void;
  setCapture: (on: boolean, port?: number | null) => void;
  ingest: (events: TrafficEvent[]) => void;
  clear: () => void;
  setInstallLog: (line: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setTarget: (serial: string | null, avd: string | null) => void;
  setOnboarding: (t: OnboardingTarget | null) => void;
}

export const useTraffic = create<TrafficState>((set) => ({
  exchanges: new Map(),
  order: [],
  wsConnections: new Map(),
  activeView: "requests",
  captureOn: false,
  capturePort: null,
  requestCount: 0,
  installLog: null,
  settingsOpen: false,
  targetSerial: null,
  targetAvd: null,
  onboarding: null,
  setActiveView: (v) => set({ activeView: v }),
  setCapture: (on, port = null) => set({ captureOn: on, capturePort: on ? port : null }),
  setInstallLog: (line) => set({ installLog: line }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setTarget: (serial, avd) => set({ targetSerial: serial, targetAvd: avd }),
  setOnboarding: (t) => set({ onboarding: t }),
  clear: () =>
    set({
      exchanges: new Map(),
      order: [],
      wsConnections: new Map(),
      requestCount: 0,
    }),
  ingest: (events) =>
    set((s) => {
      const exchanges = new Map(s.exchanges);
      const order = s.order;
      let orderChanged = false;
      const wsConnections = new Map(s.wsConnections);
      let count = s.requestCount;
      for (const ev of events) {
        switch (ev.type) {
          case "ExchangeStarted": {
            exchanges.set(ev.id, {
              id: ev.id,
              request: ev.request,
              response: null,
              error: null,
              timing: { ttfb_ms: null, download_ms: null, total_ms: null },
              protocol: "",
            });
            if (!order.includes(ev.id)) {
              order.push(ev.id);
              orderChanged = true;
            }
            count += 1;
            break;
          }
          case "ExchangeCompleted": {
            const ex = exchanges.get(ev.id);
            if (ex) {
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
              exchanges.set(ev.id, { ...ex, error: ev.error });
            }
            break;
          }
          case "Ws": {
            applyWs(wsConnections, ev);
            break;
          }
        }
      }
      if (!orderChanged && count === s.requestCount && wsConnections.size === s.wsConnections.size) {
        if (exchanges === s.exchanges) return s;
      }
      return { exchanges, order: [...order], wsConnections, requestCount: count };
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
