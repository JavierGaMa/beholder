import { describe, expect, it } from "vitest";
import { buildTimeline } from "./timeline";
import type { ConsoleEntry, LogLine } from "../../store/console-types";
import type { HttpExchange } from "../../store/types";

function line(partial: Partial<LogLine> = {}): LogLine {
  return {
    ts_ms: 100,
    level: "Info",
    pid: 1,
    tid: 1,
    tag: "T",
    buffer: "Main",
    message: "m",
    is_crash: false,
    repeat_count: 1,
    ...partial,
  };
}

function exchange(id: number, startedAt: number, partial: Partial<HttpExchange> = {}): HttpExchange {
  return {
    id,
    request: {
      method: "GET",
      url: "https://h.example/p",
      host: "h.example",
      path: "/p",
      headers: [],
      body: null,
      started_at: startedAt,
    },
    response: null,
    error: null,
    timing: { ttfb_ms: null, download_ms: null, total_ms: null },
    protocol: "",
    ...partial,
  };
}

function mapOf(...items: HttpExchange[]): Map<number, HttpExchange> {
  return new Map(items.map((e) => [e.id, e]));
}

describe("buildTimeline", () => {
  it("interleaves logs and exchanges by timestamp", () => {
    const entries: ConsoleEntry[] = [line({ ts_ms: 100 }), line({ ts_ms: 300 })];
    const exchanges = mapOf(exchange(1, 200), exchange(2, 400));
    const items = buildTimeline(entries, exchanges, [1, 2], 0);
    expect(items.map((i) => i.kind)).toEqual(["log", "exchange", "log", "exchange"]);
    expect(items.map((i) => i.at)).toEqual([100, 200, 300, 400]);
  });

  it("applies skew to log timestamps only", () => {
    const entries: ConsoleEntry[] = [line({ ts_ms: 100 })];
    const exchanges = mapOf(exchange(1, 120));
    const items = buildTimeline(entries, exchanges, [1], 50);
    expect(items.map((i) => i.kind)).toEqual(["exchange", "log"]);
    expect(items[1]).toMatchObject({ kind: "log", at: 150 });
    const negative = buildTimeline(entries, exchanges, [1], -80);
    expect(negative.map((i) => i.kind)).toEqual(["log", "exchange"]);
    expect(negative[0]).toMatchObject({ kind: "log", at: 20 });
  });

  it("breaks ties with the log before the exchange", () => {
    const entries: ConsoleEntry[] = [line({ ts_ms: 100 })];
    const exchanges = mapOf(exchange(1, 100));
    const items = buildTimeline(entries, exchanges, [1], 0);
    expect(items.map((i) => i.kind)).toEqual(["log", "exchange"]);
  });

  it("preserves gap items anchored to the previous log timestamp", () => {
    const entries: ConsoleEntry[] = [
      line({ ts_ms: 100 }),
      { kind: "gap", dropped: 5 },
      line({ ts_ms: 600 }),
    ];
    const exchanges = mapOf(exchange(1, 300));
    const items = buildTimeline(entries, exchanges, [1], 0);
    expect(items.map((i) => i.kind)).toEqual(["log", "gap", "exchange", "log"]);
    expect(items[1]).toEqual({ kind: "gap", dropped: 5, at: 100 });
  });

  it("skips exchange ids missing from the map", () => {
    const entries: ConsoleEntry[] = [line({ ts_ms: 100 })];
    const exchanges = mapOf(exchange(2, 50));
    const items = buildTimeline(entries, exchanges, [1, 2, 3], 0);
    expect(items.map((i) => i.kind)).toEqual(["exchange", "log"]);
    expect(items[0]).toMatchObject({ kind: "exchange", exchange: { id: 2 } });
  });

  it("sorts exchanges by started_at regardless of order array", () => {
    const entries: ConsoleEntry[] = [];
    const exchanges = mapOf(exchange(1, 300), exchange(2, 100), exchange(3, 200));
    const items = buildTimeline(entries, exchanges, [1, 2, 3], 0);
    expect(items.map((i) => i.kind)).toEqual(["exchange", "exchange", "exchange"]);
    expect(items.map((i) => (i.kind === "exchange" ? i.exchange.id : -1))).toEqual([2, 3, 1]);
  });

  it("emits pending exchange items with a null response", () => {
    const entries: ConsoleEntry[] = [];
    const ex = exchange(1, 900);
    const items = buildTimeline(entries, mapOf(ex), [1], 0);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ kind: "exchange", at: 900, exchange: ex });
    expect(items[0].kind === "exchange" && items[0].exchange.response).toBeNull();
    expect(items[0].kind === "exchange" && items[0].exchange.timing.total_ms).toBeNull();
  });

  it("emits failed exchange items carrying the error", () => {
    const entries: ConsoleEntry[] = [];
    const ex = exchange(1, 900, { error: "connection reset" });
    const items = buildTimeline(entries, mapOf(ex), [1], 0);
    expect(items).toHaveLength(1);
    expect(items[0].kind === "exchange" && items[0].exchange.error).toBe("connection reset");
    expect(items[0].kind === "exchange" && items[0].exchange.response).toBeNull();
  });
});
