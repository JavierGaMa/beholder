import type { HttpExchange } from "../../store/types";
import { computeMetrics, type DomainStat, type MetricTotals } from "./metrics";

export const MAX_SNAPSHOTS = 20;

export interface MetricSnapshot {
  id: string;
  label: string;
  createdAt: number;
  totals: MetricTotals;
  domains: DomainStat[];
  coverage: { captured: number; total: number };
}

export interface SnapshotDomainRow {
  host: string;
  a: DomainStat | null;
  b: DomainStat | null;
  deltaWire: number;
  deltaCount: number;
}

export interface SnapshotComparison {
  totals: {
    wireBytesIn: number;
    bytesOut: number;
    count: number;
    failed: number;
    p95DeltaMs: number | null;
  };
  domains: SnapshotDomainRow[];
}

export function buildSnapshot(
  exchanges: HttpExchange[],
  meta: {
    id: string;
    label: string;
    createdAt: number;
    captured: number;
    total: number;
  },
): MetricSnapshot {
  const metrics = computeMetrics(exchanges, { domainLimit: Infinity });
  return {
    id: meta.id,
    label: meta.label,
    createdAt: meta.createdAt,
    totals: metrics.totals,
    domains: metrics.byDomain,
    coverage: { captured: meta.captured, total: meta.total },
  };
}

export function serializeSnapshots(list: MetricSnapshot[]): string {
  return JSON.stringify(list);
}

export function parseSnapshots(raw: string | null): MetricSnapshot[] {
  const parsed = raw == null ? null : tryParseSnapshots(raw);
  return parsed ?? [];
}

function tryParseSnapshots(raw: string): MetricSnapshot[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const snapshots: MetricSnapshot[] = [];
  for (const entry of parsed) {
    const snap = tryParseSnapshot(entry);
    if (snap != null) snapshots.push(snap);
  }
  const capped = snapshots.slice(-MAX_SNAPSHOTS);
  return capped;
}

function tryParseSnapshot(entry: unknown): MetricSnapshot | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
  const source = entry as Record<string, unknown>;
  if (typeof source.id !== "string" || source.id === "") return null;
  if (typeof source.label !== "string") return null;
  if (typeof source.createdAt !== "number") return null;
  if (typeof source.totals !== "object" || source.totals === null) return null;
  if (!Array.isArray(source.domains)) return null;
  if (typeof source.coverage !== "object" || source.coverage === null) return null;
  return entry as MetricSnapshot;
}

export function compareSnapshots(a: MetricSnapshot, b: MetricSnapshot): SnapshotComparison {
  const hosts = new Map<string, { a: DomainStat | null; b: DomainStat | null }>();
  for (const stat of a.domains) hosts.set(stat.host, { a: stat, b: null });
  for (const stat of b.domains) {
    const existing = hosts.get(stat.host);
    if (existing == null) hosts.set(stat.host, { a: null, b: stat });
    else existing.b = stat;
  }
  const domains = [...hosts.entries()]
    .map(([host, pair]) => ({
      host,
      a: pair.a,
      b: pair.b,
      deltaWire: (pair.b?.wireBytesIn ?? 0) - (pair.a?.wireBytesIn ?? 0),
      deltaCount: (pair.b?.count ?? 0) - (pair.a?.count ?? 0),
    }))
    .sort((x, y) => Math.abs(y.deltaWire) - Math.abs(x.deltaWire));
  const p95a = a.totals.p95Ms;
  const p95b = b.totals.p95Ms;
  return {
    totals: {
      wireBytesIn: b.totals.wireBytesIn - a.totals.wireBytesIn,
      bytesOut: b.totals.bytesOut - a.totals.bytesOut,
      count: b.totals.count - a.totals.count,
      failed: b.totals.failed - a.totals.failed,
      p95DeltaMs: p95a != null && p95b != null ? p95b - p95a : null,
    },
    domains,
  };
}
