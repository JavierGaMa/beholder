import { describe, expect, it } from "vitest";
import { MAX_EXCHANGES, MAX_WS_FRAMES, useTraffic } from "./traffic";
import type { TrafficEvent } from "./types";

const started = (id: number): TrafficEvent => ({
  type: "ExchangeStarted",
  id,
  request: { method: "GET", url: `https://a.dev/${id}`, host: "a.dev", path: `/${id}`, headers: [], body: null, started_at: 1 },
});

const completed = (id: number, status = 200): TrafficEvent => ({
  type: "ExchangeCompleted",
  id,
  response: { status, headers: [], body: null, ended_at: 2 },
  timing: { ttfb_ms: 5, download_ms: 3, total_ms: 8 },
  protocol: "HTTP/1.1",
});

describe("traffic store ingest", () => {
  it("creates exchange on start and completes it", () => {
    useTraffic.getState().clear();
    useTraffic.getState().ingest([started(1), completed(1)]);
    const st = useTraffic.getState();
    expect(st.order).toEqual([1]);
    expect(st.exchanges.get(1)?.response?.status).toBe(200);
    expect(st.requestCount).toBe(1);
  });

  it("keeps order stable across batches", () => {
    useTraffic.getState().clear();
    useTraffic.getState().ingest([started(2), started(3)]);
    useTraffic.getState().ingest([completed(2), completed(3, 404)]);
    const st = useTraffic.getState();
    expect(st.order).toEqual([2, 3]);
    expect(st.exchanges.get(3)?.response?.status).toBe(404);
  });

  it("marks failed exchanges", () => {
    useTraffic.getState().clear();
    useTraffic.getState().ingest([started(5), { type: "ExchangeFailed", id: 5, error: "boom" }]);
    const st = useTraffic.getState();
    expect(st.exchanges.get(5)?.error).toBe("boom");
  });

  it("tracks ws connections and frames", () => {
    useTraffic.getState().clear();
    useTraffic.getState().ingest([
      { type: "Ws", kind: "Opened", id: 9, url: "wss://x.dev", opened_at: 1 } as never,
      { type: "Ws", kind: "Frame", id: 9, seq: 1, direction: "Sent", payload: { text: "hi", is_binary: false, size: 2, truncated: false, mime: "text/plain" }, at: 2 } as never,
    ]);
    const st = useTraffic.getState();
    const conn = st.wsConnections.get(9);
    expect(conn?.url).toBe("wss://x.dev");
    expect(conn?.frames.length).toBe(1);
    expect(conn?.frames[0].direction).toBe("Sent");
  });
});

describe("traffic store bounds", () => {
  it("trims the exchange ring to MAX_EXCHANGES evicting oldest", () => {
    useTraffic.getState().clear();
    const events: TrafficEvent[] = [];
    for (let id = 1; id <= MAX_EXCHANGES + 10; id++) events.push(started(id));
    useTraffic.getState().ingest(events);
    const st = useTraffic.getState();
    expect(st.order.length).toBe(MAX_EXCHANGES);
    expect(st.exchanges.get(1)).toBeUndefined();
    expect(st.exchanges.get(2010)).toBeDefined();
    expect(st.order[0]).toBe(11);
    expect(st.requestCount).toBe(2010);
  });

  it("dedupes duplicate starts keeping one order entry", () => {
    useTraffic.getState().clear();
    useTraffic.getState().ingest([started(1), started(1)]);
    const st = useTraffic.getState();
    expect(st.order).toEqual([1]);
    expect(st.exchanges.size).toBe(1);
    expect(st.requestCount).toBe(2);
  });

  it("caps ws frames keeping the newest", () => {
    useTraffic.getState().clear();
    const events: TrafficEvent[] = [
      { type: "Ws", kind: "Opened", id: 9, url: "wss://x.dev", opened_at: 1 } as never,
    ];
    for (let seq = 1; seq <= MAX_WS_FRAMES + 10; seq++) {
      events.push({
        type: "Ws",
        kind: "Frame",
        id: 9,
        seq,
        direction: "Sent",
        payload: { text: "hi", is_binary: false, size: 2, truncated: false, mime: "text/plain" },
        at: seq,
      } as never);
    }
    useTraffic.getState().ingest(events);
    const conn = useTraffic.getState().wsConnections.get(9);
    expect(conn?.frames.length).toBe(MAX_WS_FRAMES);
    expect(conn?.frames[0].seq).toBe(11);
    expect(conn?.frames[conn.frames.length - 1].seq).toBe(510);
  });

  it("returns the same state object for a no-op batch", () => {
    useTraffic.getState().clear();
    useTraffic.getState().ingest([started(1)]);
    const before = useTraffic.getState();
    useTraffic.getState().ingest([completed(999)]);
    expect(useTraffic.getState()).toBe(before);
  });
});

describe("traffic store metro status", () => {
  const metroStatus = {
    detected: true,
    port: 8081,
  };

  it("stores metro status via setMetro", () => {
    useTraffic.getState().setMetro(metroStatus);
    expect(useTraffic.getState().metro).toEqual(metroStatus);
    useTraffic.getState().setMetro(null);
    expect(useTraffic.getState().metro).toBeNull();
  });

  it("clears metro status when capture turns off", () => {
    useTraffic.getState().setMetro(metroStatus);
    useTraffic.getState().setCapture(true, 9090);
    expect(useTraffic.getState().metro).toEqual(metroStatus);
    useTraffic.getState().setCapture(false);
    expect(useTraffic.getState().metro).toBeNull();
  });
});
