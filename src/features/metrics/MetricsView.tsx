import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Inbox, Save, Trash2 } from "lucide-react";
import { useTraffic } from "../../store/traffic";
import { invoke, isTauri } from "../../lib/tauri";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { formatBytes, formatMs, formatTime } from "../../lib/format";
import { loadMetricSnapshots, loadSlowMs, saveMetricSnapshots } from "../../lib/prefs";
import { computeMetrics, mediaStats } from "./metrics";
import { BucketBars, timeTicks, valueTicks } from "./charts";
import {
  buildSnapshot,
  compareSnapshots,
  MAX_SNAPSHOTS,
  type MetricSnapshot,
} from "./snapshots";

const CURRENT_OPTION = "__current";

function Stat({
  label,
  value,
  sub,
  danger,
}: {
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <span className="block truncate text-[11px] text-muted">{label}</span>
      <span
        className={clsx(
          "block truncate font-mono text-[20px] font-semibold leading-7 tabular-nums",
          danger ? "text-danger" : "text-txt",
        )}
      >
        {value}
      </span>
      {sub != null && <span className="block truncate text-[11px] text-muted">{sub}</span>}
    </div>
  );
}

export function MetricsView() {
  const exchanges = useTraffic((s) => s.exchanges);
  const requestCount = useTraffic((s) => s.requestCount);
  const sessionBytesIn = useTraffic((s) => s.sessionBytesIn);
  const sessionBytesOut = useTraffic((s) => s.sessionBytesOut);
  const sessionFailed = useTraffic((s) => s.sessionFailed);
  const requestSelect = useTraffic((s) => s.requestSelect);
  const metrics = useMemo(() => computeMetrics([...exchanges.values()]), [exchanges]);
  const media = useMemo(() => mediaStats([...exchanges.values()]), [exchanges]);
  const { byDomain, buckets, slowest } = metrics;
  const windowTruncated = requestCount > exchanges.size;
  const [snapshots, setSnapshots] = useState<MetricSnapshot[]>(() => loadMetricSnapshots());
  const [compareA, setCompareA] = useState(CURRENT_OPTION);
  const [compareB, setCompareB] = useState("");

  useEffect(() => {
    if (!isTauri || snapshots.length === 0) return;
    void invoke("agent_sync_snapshots", { list: JSON.stringify(snapshots) }).catch(() => {});
  }, [snapshots]);

  const currentSnapshot = useMemo(
    () =>
      buildSnapshot([...exchanges.values()], {
        id: CURRENT_OPTION,
        label: "Current session",
        createdAt: Date.now(),
        captured: exchanges.size,
        total: requestCount,
      }),
    [exchanges, requestCount],
  );

  function saveSnapshot() {
    const snap = buildSnapshot([...exchanges.values()], {
      id: `snap-${Date.now()}`,
      label: formatTime(Date.now()),
      createdAt: Date.now(),
      captured: exchanges.size,
      total: requestCount,
    });
    const next = [...snapshots, snap].slice(-MAX_SNAPSHOTS);
    setSnapshots(next);
    saveMetricSnapshots(next);
    if (compareB === "") setCompareB(snap.id);
  }

  function deleteSnapshot(id: string) {
    const next = snapshots.filter((s) => s.id !== id);
    setSnapshots(next);
    saveMetricSnapshots(next);
    if (compareB === id) setCompareB("");
    if (compareA === id) setCompareA(CURRENT_OPTION);
  }

  function resolveSnapshot(optionId: string): MetricSnapshot | null {
    if (optionId === CURRENT_OPTION) return currentSnapshot;
    return snapshots.find((s) => s.id === optionId) ?? null;
  }

  const a = resolveSnapshot(compareA);
  const b = resolveSnapshot(compareB);
  const comparison = a != null && b != null && a.id !== b.id ? compareSnapshots(a, b) : null;

  if (requestCount === 0) {
    return (
      <div className="panel flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <Inbox size={28} className="text-muted/60" />
        <p className="text-sm font-medium text-txt">No traffic captured yet</p>
        <p className="max-w-xs text-[12px] text-muted">
          Start a capture session and this view will show data usage and latency for the
          traffic flowing through the proxy.
        </p>
      </div>
    );
  }

  const rangeStart = buckets[0]?.t0 ?? 0;
  const bucketWidth = buckets.length > 1 ? buckets[1].t0 - buckets[0].t0 : 0;
  const rangeEnd = (buckets[buckets.length - 1]?.t0 ?? 0) + bucketWidth;
  const downloaded = buckets.map((bucket) => bucket.bytesIn);
  const yTicks = valueTicks(Math.max(0, ...downloaded));
  const xTicks = buckets.length > 0 ? timeTicks(rangeStart, rangeEnd, 5) : [];
  const slowMs = loadSlowMs();
  const failedShare =
    requestCount > 0 ? `${((sessionFailed / requestCount) * 100).toFixed(1)}% of requests` : undefined;

  return (
    <section aria-label="Metrics" className="panel h-full overflow-y-auto">
      <div className="flex max-w-[1180px] flex-col gap-5 px-6 pb-6 pt-3">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <h2 className="text-[13px] font-semibold text-txt">Compare</h2>
          <div className="w-44">
            <Select
              value={compareA}
              onChange={(e) => setCompareA(e.target.value)}
              aria-label="Baseline snapshot"
            >
              <option value={CURRENT_OPTION}>Current session</option>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <span className="text-muted">against</span>
          <div className="w-44">
            <Select
              value={compareB}
              onChange={(e) => setCompareB(e.target.value)}
              aria-label="Comparison snapshot"
            >
              <option value="">Pick a snapshot</option>
              <option value={CURRENT_OPTION}>Current session</option>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <span className="flex-1" />
          <Button
            variant="subtle"
            size="sm"
            onClick={saveSnapshot}
            disabled={snapshots.length >= MAX_SNAPSHOTS}
            title={
              snapshots.length >= MAX_SNAPSHOTS
                ? `Up to ${MAX_SNAPSHOTS} snapshots`
                : "Save current session metrics"
            }
          >
            <Save size={13} /> Save snapshot
          </Button>
        </div>

        <section aria-label="Snapshots" className="-mt-3 flex flex-wrap items-center gap-1.5">
          {snapshots.length === 0 ? (
            <p className="text-[11px] text-muted">
              Save a snapshot of the current session, then capture again and compare the two.
            </p>
          ) : (
            snapshots.map((s) => (
              <span
                key={s.id}
                className="inline-flex h-6 items-center gap-1.5 rounded-[var(--radius-sm)] bg-surface-2 pl-2 pr-0.5 font-mono text-[11px] tabular-nums"
              >
                <span className="text-txt/90">{s.label}</span>
                <span className="text-muted">
                  {s.coverage.total} reqs · {formatBytes(s.totals.wireBytesIn)}
                </span>
                <button
                  type="button"
                  onClick={() => deleteSnapshot(s.id)}
                  aria-label={`Delete snapshot ${s.label}`}
                  title={`Delete snapshot ${s.label}`}
                  className="focus-ring grid size-5 place-items-center rounded text-muted transition-colors hover:bg-surface hover:text-txt"
                >
                  <Trash2 size={11} />
                </button>
              </span>
            ))
          )}
        </section>

        {comparison != null && (
          <section aria-label="Comparison" className="rounded-[var(--radius-md)] bg-surface-2/50 p-1.5">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[11px] text-muted">
                <tr>
                  <th className="px-2.5 py-1.5 font-normal">Domain</th>
                  <th className="px-2 py-1.5 text-right font-normal">A</th>
                  <th className="px-2 py-1.5 text-right font-normal">B</th>
                  <th className="px-2 py-1.5 text-right font-normal">Δ Down</th>
                  <th className="px-2.5 py-1.5 text-right font-normal">Δ Reqs</th>
                </tr>
              </thead>
              <tbody>
                {comparison.domains.slice(0, 15).map((row) => (
                  <tr key={row.host} className={ROW}>
                    <td className="max-w-[200px] truncate px-2.5 font-mono text-txt/90">{row.host}</td>
                    <td className="px-2 text-right font-mono tabular-nums text-muted">
                      {formatBytes(row.a?.wireBytesIn ?? 0)}
                    </td>
                    <td className="px-2 text-right font-mono tabular-nums text-muted">
                      {formatBytes(row.b?.wireBytesIn ?? 0)}
                    </td>
                    <td
                      className={clsx(
                        "px-2 text-right font-mono tabular-nums",
                        row.deltaWire > 0
                          ? "text-txt"
                          : row.deltaWire < 0
                            ? "text-ok"
                            : "text-muted",
                      )}
                    >
                      {row.deltaWire >= 0 ? "+" : "−"}
                      {formatBytes(Math.abs(row.deltaWire))}
                    </td>
                    <td className="px-2.5 text-right font-mono tabular-nums text-muted">
                      {row.deltaCount >= 0 ? "+" : "−"}
                      {Math.abs(row.deltaCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {comparison.domains.length > 15 && (
              <p className="px-2.5 py-1.5 text-[11px] text-muted">
                +{comparison.domains.length - 15} more domains
              </p>
            )}
            <p className="px-2.5 py-2 text-[11px] text-muted">
              Totals Δ: down {signedBytes(comparison.totals.wireBytesIn)} · up{" "}
              {signedBytes(comparison.totals.bytesOut)} · reqs{" "}
              {signedNumber(comparison.totals.count)} · failed{" "}
              {signedNumber(comparison.totals.failed)} · p95{" "}
              {comparison.totals.p95DeltaMs == null
                ? "n/a"
                : signedMs(comparison.totals.p95DeltaMs)}
            </p>
          </section>
        )}

        <div className="grid grid-cols-2 divide-line overflow-hidden rounded-[var(--radius-md)] bg-surface-2 sm:grid-cols-5 sm:divide-x">
          <Stat
            label="Downloaded"
            value={formatBytes(sessionBytesIn)}
            sub={
              sessionBytesIn === metrics.totals.bytesIn
                ? "response bodies"
                : `decoded ${formatBytes(metrics.totals.bytesIn)}`
            }
          />
          <Stat label="Uploaded" value={formatBytes(sessionBytesOut)} sub="request bodies" />
          <Stat label="Requests" value={String(requestCount)} />
          <Stat
            label="Failed"
            value={String(sessionFailed)}
            sub={failedShare}
            danger={sessionFailed > 0}
          />
          <Stat
            label="P95 latency"
            value={formatMs(metrics.totals.p95Ms)}
            sub={`p50 ${formatMs(metrics.totals.p50Ms)} · ttfb ${formatMs(metrics.totals.avgTtfbMs)}`}
          />
        </div>

        {windowTruncated && (
          <p className="-mt-2 text-[11px] text-muted">
            Showing the last {exchanges.size} of {requestCount} requests. Totals above cover
            the whole session; domain and latency breakdowns cover the visible window only.
          </p>
        )}

        <section aria-label="Throughput">
          <h2 className="pb-2 text-[13px] font-semibold text-txt">Downloaded over time</h2>
          <div className="flex gap-2">
            <div className="relative h-28 w-12 shrink-0 font-mono text-[10px] tabular-nums text-muted">
              {yTicks.map((tick, i) => (
                <span
                  key={i}
                  className="absolute right-0 -translate-y-1/2"
                  style={{ top: `${100 - (yTicks.length > 1 ? (i / (yTicks.length - 1)) * 100 : 0)}%` }}
                >
                  {formatBytes(tick)}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative h-28">
                {yTicks.map((_, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className="absolute inset-x-0 h-px bg-line/60"
                    style={{ top: `${100 - (yTicks.length > 1 ? (i / (yTicks.length - 1)) * 100 : 0)}%` }}
                  />
                ))}
                <div className="absolute inset-0">
                  <BucketBars values={downloaded} label="Downloaded bytes per time bucket" />
                </div>
              </div>
              <div className="relative mt-1.5 h-3 font-mono text-[10px] tabular-nums text-muted">
                {xTicks.map((tick, i) => (
                  <span
                    key={i}
                    className={clsx(
                      "absolute top-0 whitespace-nowrap",
                      i === 0 ? "" : i === xTicks.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
                    )}
                    style={{ left: `${tick.ratio * 100}%` }}
                  >
                    {clockTime(tick.t)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
          <section aria-label="Top domains" className="min-w-0">
            <h2 className="pb-1 text-[13px] font-semibold text-txt">Top domains</h2>
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-surface text-[11px] text-muted">
                  <tr>
                    <th className="px-2.5 py-1.5 font-normal">Domain</th>
                    <th className="px-2 py-1.5 text-right font-normal">Reqs</th>
                    <th className="px-2 py-1.5 text-right font-normal">Failed</th>
                    <th className="px-2 py-1.5 text-right font-normal">Down</th>
                    <th className="px-2 py-1.5 text-right font-normal">Up</th>
                    <th className="px-2.5 py-1.5 text-right font-normal">P95</th>
                  </tr>
                </thead>
                <tbody>
                  {byDomain.map((d) => (
                    <tr key={d.host} className={ROW}>
                      <td className="max-w-[220px] truncate px-2.5 font-mono text-txt">{d.host}</td>
                      <td className="px-2 text-right font-mono tabular-nums text-muted">{d.count}</td>
                      <td className="px-2 text-right font-mono tabular-nums">
                        {d.failed > 0 ? (
                          <span className="rounded-[var(--radius-sm)] bg-danger/15 px-1.5 py-px text-danger">
                            {d.failed}
                          </span>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                      <td className="px-2 text-right font-mono tabular-nums text-txt">
                        {formatBytes(d.wireBytesIn)}
                      </td>
                      <td className="px-2 text-right font-mono tabular-nums text-muted">
                        {formatBytes(d.bytesOut)}
                      </td>
                      <td
                        className={clsx(
                          "px-2.5 text-right font-mono tabular-nums",
                          d.p95Ms != null && d.p95Ms > slowMs ? "text-warn" : "text-muted",
                        )}
                      >
                        {formatMs(d.p95Ms)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="flex min-w-0 flex-col gap-5">
            <section aria-label="Slowest requests">
              <h2 className="pb-1 text-[13px] font-semibold text-txt">Slowest requests</h2>
              <ul>
                {slowest.map((exchange) => {
                  const ms = exchange.timing.total_ms;
                  return (
                    <li key={exchange.id}>
                      <button
                        type="button"
                        onClick={() => requestSelect(exchange.id)}
                        title="Open in Requests"
                        className={ACTION_ROW}
                      >
                        <span className="w-12 shrink-0 font-mono text-[11px] text-muted">
                          {exchange.request.method}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono">
                          <span className="text-muted">{exchange.request.host}</span>
                          <span className="text-txt/90">{exchange.request.path}</span>
                        </span>
                        <span
                          className={clsx(
                            "shrink-0 font-mono text-[12px] font-medium tabular-nums",
                            ms != null && ms > slowMs ? "text-warn" : "text-muted",
                          )}
                        >
                          {formatMs(ms)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section aria-label="Media and downloads">
              <h2 className="pb-1.5 text-[13px] font-semibold text-txt">Media and downloads</h2>
              {media.categories.length === 0 ? (
                <p className="text-[11px] text-muted">
                  No image, video, audio or binary downloads captured in this window.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5 pb-1.5">
                    {media.categories.map((c) => (
                      <span
                        key={c.category}
                        className="rounded-[var(--radius-sm)] bg-surface-2 px-2 py-0.5 font-mono text-[11px] tabular-nums text-txt/90"
                      >
                        {c.category}, {c.count}, {formatBytes(c.bytes)}
                      </span>
                    ))}
                  </div>
                  <ul>
                    {media.top.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => requestSelect(item.id)}
                          title="Open in Requests"
                          className={ACTION_ROW}
                        >
                          <span className="w-12 shrink-0 font-mono text-[11px] text-muted">
                            {item.method}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono">
                            <span className="text-muted">{item.host}</span>
                            <span className="text-txt/90">{item.path}</span>
                          </span>
                          <span className="shrink-0 rounded-[var(--radius-sm)] bg-surface-2 px-1.5 py-px font-mono text-[10px] text-muted">
                            {item.mime}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                            {formatBytes(item.size)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}

const ROW =
  "h-8 transition-colors [transition-duration:var(--dur-fast)] hover:bg-surface-2 [&>td:first-child]:rounded-l-[var(--radius-md)] [&>td:last-child]:rounded-r-[var(--radius-md)]";

const ACTION_ROW =
  "focus-ring flex h-8 w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-left text-[12px] transition-colors [transition-duration:var(--dur-fast)] hover:bg-surface-2";

function clockTime(unixMs: number): string {
  return new Date(unixMs).toLocaleTimeString([], { hour12: false });
}

function signedBytes(n: number): string {
  return `${n >= 0 ? "+" : "−"}${formatBytes(Math.abs(n))}`;
}

function signedNumber(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;
}

function signedMs(n: number): string {
  return `${n >= 0 ? "+" : "−"}${formatMs(Math.abs(n))}`;
}
