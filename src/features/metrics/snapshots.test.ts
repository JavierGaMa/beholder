import { describe, expect, it } from "vitest";
import type { HttpExchange } from "../../store/types";
import { buildSnapshot, compareSnapshots, parseSnapshots, serializeSnapshots } from "./snapshots";

let nextId = 1;

function ex(host: string, outBytes: number, wire: number): HttpExchange {
  return {
    id: nextId++,
    request: {
      method: "GET",
      url: `https://${host}/p`,
      host,
      path: "/p",
      headers: [],
      body: undefined,
      started_at: 1_000,
    },
    response: {
      status: 200,
      headers: [],
      body: { mime: null, size: outBytes, wire_size: wire, truncated: false, text: "", is_binary: false },
      ended_at: 1_010,
    },
    error: null,
    timing: { ttfb_ms: 5, download_ms: 5, total_ms: 10 },
    protocol: "h2",
  };
}

function makeSnapshot(label: string, wire: number) {
  return buildSnapshot([ex("a.com", wire * 2, wire)], {
    id: `snap-${label}`,
    label,
    createdAt: 1_000,
    captured: 1,
    total: 1,
  });
}

describe("buildSnapshot", () => {
  it("carries meta and full domain stats without the top-10 cap", () => {
    const exchanges = Array.from({ length: 12 }, (_, i) => ex(`h${i}.com`, 100, 10 + i));
    const snap = buildSnapshot(exchanges, {
      id: "s1",
      label: "before",
      createdAt: 5_000,
      captured: 12,
      total: 20,
    });
    expect(snap.id).toBe("s1");
    expect(snap.label).toBe("before");
    expect(snap.createdAt).toBe(5_000);
    expect(snap.coverage).toEqual({ captured: 12, total: 20 });
    expect(snap.domains).toHaveLength(12);
    expect(snap.totals.count).toBe(12);
  });
});

describe("snapshot persistence", () => {
  it("round-trips through serialize and parse", () => {
    const list = [makeSnapshot("a", 10), makeSnapshot("b", 20)];
    const parsed = parseSnapshots(serializeSnapshots(list));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].label).toBe("a");
    expect(parsed[0].totals.wireBytesIn).toBe(10);
  });

  it("caps the stored list and drops garbage", () => {
    expect(parseSnapshots("not json")).toEqual([]);
    expect(parseSnapshots(null)).toEqual([]);
    const many = Array.from({ length: 25 }, (_, i) => makeSnapshot(`s${i}`, i));
    const parsed = parseSnapshots(serializeSnapshots(many));
    expect(parsed).toHaveLength(20);
    expect(parsed[0].label).toBe("s5");
    expect(parsed[19].label).toBe("s24");
  });
});

describe("compareSnapshots", () => {
  it("returns totals deltas and per-domain rows sorted by abs wire delta", () => {
    const a = buildSnapshot(
      [ex("x.com", 100, 100), ex("gone.com", 40, 40)],
      { id: "a", label: "a", createdAt: 1, captured: 2, total: 2 },
    );
    const b = buildSnapshot(
      [ex("x.com", 120, 150), ex("new.com", 60, 50)],
      { id: "b", label: "b", createdAt: 2, captured: 2, total: 2 },
    );
    const cmp = compareSnapshots(a, b);
    expect(cmp.totals.wireBytesIn).toBe(60);
    expect(cmp.totals.count).toBe(0);
    expect(cmp.domains.map((r) => r.host)).toEqual(["x.com", "new.com", "gone.com"]);
    expect(cmp.domains[0].deltaWire).toBe(50);
    expect(cmp.domains[1].a).toBeNull();
    expect(cmp.domains[2].b).toBeNull();
    expect(cmp.domains[2].deltaWire).toBe(-40);
  });

  it("handles null p95 deltas", () => {
    const a = makeSnapshot("a", 10);
    const b = makeSnapshot("b", 20);
    const cmp = compareSnapshots(a, b);
    expect(cmp.totals.p95DeltaMs).toBe(0);
  });
});
