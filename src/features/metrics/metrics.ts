import type { HttpExchange } from "../../store/types";
import { isFailed } from "../requests/filters";

export interface MetricTotals {
  count: number;
  failed: number;
  bytesIn: number;
  wireBytesIn: number;
  bytesOut: number;
  p50Ms: number | null;
  p95Ms: number | null;
  avgTtfbMs: number | null;
}

export interface DomainStat {
  host: string;
  count: number;
  failed: number;
  bytesIn: number;
  wireBytesIn: number;
  bytesOut: number;
  p95Ms: number | null;
}

export interface TimeBucket {
  t0: number;
  bytesIn: number;
  bytesOut: number;
  count: number;
}

export interface Metrics {
  totals: MetricTotals;
  byDomain: DomainStat[];
  buckets: TimeBucket[];
  slowest: HttpExchange[];
}

const BUCKET_COUNT = 60;
const SLOWEST_LIMIT = 5;

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function wireIn(exchange: HttpExchange): number {
  return exchange.response?.body?.wire_size ?? exchange.response?.body?.size ?? 0;
}

function emptyTotals(): MetricTotals {
  return {
    count: 0,
    failed: 0,
    bytesIn: 0,
    wireBytesIn: 0,
    bytesOut: 0,
    p50Ms: null,
    p95Ms: null,
    avgTtfbMs: null,
  };
}

interface HostAccumulator {
  count: number;
  failed: number;
  bytesIn: number;
  wireBytesIn: number;
  bytesOut: number;
  ms: number[];
}

export interface MediaItem {
  id: number;
  mime: string;
  size: number;
  method: string;
  path: string;
  host: string;
}

export interface MediaCategory {
  category: "image" | "video" | "audio" | "other";
  count: number;
  bytes: number;
}

export interface MediaStats {
  categories: MediaCategory[];
  top: MediaItem[];
}

const MEDIA_ORDER: MediaCategory["category"][] = ["image", "video", "audio", "other"];

function mediaCategory(mime: string, isBinary: boolean): MediaCategory["category"] | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("octet-stream") || (isBinary && mime === "")) return "other";
  return null;
}

export function mediaStats(exchanges: HttpExchange[]): MediaStats {
  const acc = new Map<MediaCategory["category"], { count: number; bytes: number }>();
  const items: MediaItem[] = [];
  for (const exchange of exchanges) {
    const body = exchange.response?.body;
    if (body == null) continue;
    const mime = (body.mime ?? "").toLowerCase();
    const category = mediaCategory(mime, body.is_binary);
    if (category == null) continue;
    const entry = acc.get(category) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += body.size;
    acc.set(category, entry);
    items.push({
      id: exchange.id,
      mime: body.mime ?? "application/octet-stream",
      size: body.size,
      method: exchange.request.method,
      path: exchange.request.path,
      host: exchange.request.host,
    });
  }
  const categories = MEDIA_ORDER.filter((c) => acc.has(c)).map((category) => ({
    category,
    count: acc.get(category)!.count,
    bytes: acc.get(category)!.bytes,
  }));
  const top = items.sort((x, y) => y.size - x.size).slice(0, 5);
  return { categories, top };
}

export function computeMetrics(
  exchanges: HttpExchange[],
  opts: { domainLimit?: number } = {},
): Metrics {
  const domainLimit = opts.domainLimit ?? 10;
  if (exchanges.length === 0) {
    return { totals: emptyTotals(), byDomain: [], buckets: [], slowest: [] };
  }

  let bytesIn = 0;
  let wireBytesIn = 0;
  let bytesOut = 0;
  let failed = 0;
  const totalsMs: number[] = [];
  const ttfbs: number[] = [];
  const hosts = new Map<string, HostAccumulator>();
  let min = Infinity;
  let max = -Infinity;

  for (const exchange of exchanges) {
    const down = exchange.response?.body?.size ?? 0;
    const downWire = wireIn(exchange);
    const up = exchange.request.body?.size ?? 0;
    bytesIn += down;
    wireBytesIn += downWire;
    bytesOut += up;
    if (isFailed(exchange)) failed++;
    if (exchange.timing.total_ms != null) totalsMs.push(exchange.timing.total_ms);
    if (exchange.timing.ttfb_ms != null) ttfbs.push(exchange.timing.ttfb_ms);

    let stat = hosts.get(exchange.request.host);
    if (stat == null) {
      stat = { count: 0, failed: 0, bytesIn: 0, wireBytesIn: 0, bytesOut: 0, ms: [] };
      hosts.set(exchange.request.host, stat);
    }
    stat.count++;
    stat.bytesIn += down;
    stat.wireBytesIn += downWire;
    stat.bytesOut += up;
    if (isFailed(exchange)) stat.failed++;
    if (exchange.timing.total_ms != null) stat.ms.push(exchange.timing.total_ms);

    const started = exchange.request.started_at;
    if (started < min) min = started;
    if (started > max) max = started;
  }

  totalsMs.sort((a, b) => a - b);
  const avgTtfbMs =
    ttfbs.length === 0
      ? null
      : Math.round(ttfbs.reduce((sum, v) => sum + v, 0) / ttfbs.length);

  const span = max - min;
  const width = span / BUCKET_COUNT;
  const buckets: TimeBucket[] = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
    t0: min + i * width,
    bytesIn: 0,
    bytesOut: 0,
    count: 0,
  }));
  for (const exchange of exchanges) {
    const index =
      width === 0
        ? 0
        : Math.min(BUCKET_COUNT - 1, Math.floor((exchange.request.started_at - min) / width));
    const bucket = buckets[index];
    bucket.bytesIn += wireIn(exchange);
    bucket.bytesOut += exchange.request.body?.size ?? 0;
    bucket.count++;
  }

  const byDomain = [...hosts.entries()]
    .map(([host, stat]) => {
      stat.ms.sort((a, b) => a - b);
      return {
        host,
        count: stat.count,
        failed: stat.failed,
        bytesIn: stat.bytesIn,
        wireBytesIn: stat.wireBytesIn,
        bytesOut: stat.bytesOut,
        p95Ms: percentile(stat.ms, 95),
      };
    })
    .sort((a, b) => b.wireBytesIn - a.wireBytesIn || a.host.localeCompare(b.host))
    .slice(0, domainLimit === Infinity ? Infinity : Math.max(0, domainLimit));

  const slowest = exchanges
    .filter((e) => e.timing.total_ms != null)
    .sort((a, b) => (b.timing.total_ms ?? 0) - (a.timing.total_ms ?? 0))
    .slice(0, SLOWEST_LIMIT);

  return {
    totals: {
      count: exchanges.length,
      failed,
      bytesIn,
      wireBytesIn,
      bytesOut,
      p50Ms: percentile(totalsMs, 50),
      p95Ms: percentile(totalsMs, 95),
      avgTtfbMs,
    },
    byDomain,
    buckets,
    slowest,
  };
}
