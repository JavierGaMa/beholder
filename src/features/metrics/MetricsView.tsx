import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Inbox,
  Save,
  Timer,
  Trash2,
} from "lucide-react";
import { useTraffic } from "../../store/traffic";
import { invoke, isTauri } from "../../lib/tauri";
import { Button } from "../../components/ui/Button";
import { formatBytes, formatMs, formatTime, methodClass } from "../../lib/format";
import { loadMetricSnapshots, saveMetricSnapshots } from "../../lib/prefs";
import { computeMetrics } from "./metrics";
import { BucketBars } from "./charts";
import {
  buildSnapshot,
  compareSnapshots,
  MAX_SNAPSHOTS,
  type MetricSnapshot,
} from "./snapshots";

const CURRENT_OPTION = "__current";

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Activity;
  warn?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-3">
      <span
        className={clsx(
          "grid size-8 shrink-0 place-items-center rounded-md",
          warn ? "bg-warn/10 text-warn" : "bg-accent/10 text-accent",
        )}
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-medium uppercase tracking-wider text-muted/80">
          {label}
        </span>
        <span className="block truncate font-mono text-[15px] font-medium tabular-nums text-txt">
          {value}
        </span>
        {sub != null && (
          <span className="block truncate text-[11px] text-muted">{sub}</span>
        )}
      </span>
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
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <Inbox size={28} className="text-muted/60" />
        <p className="text-sm font-medium text-txt">No traffic captured yet</p>
        <p className="max-w-xs text-[12px] text-muted">
          Start a capture session and this view will show data usage and latency for the
          traffic flowing through the proxy.
        </p>
      </div>
    );
  }

  const first = buckets[0];
  const last = buckets[buckets.length - 1];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap gap-3">
        <StatCard
          label="Downloaded"
          value={formatBytes(sessionBytesIn)}
          sub={
            sessionBytesIn === metrics.totals.bytesIn
              ? "response bodies"
              : `decoded ${formatBytes(metrics.totals.bytesIn)}`
          }
          icon={ArrowDownToLine}
        />
        <StatCard
          label="Uploaded"
          value={formatBytes(sessionBytesOut)}
          sub="request bodies"
          icon={ArrowUpFromLine}
        />
        <StatCard label="Requests" value={String(requestCount)} icon={Activity} />
        <StatCard
          label="Failed"
          value={String(sessionFailed)}
          icon={AlertTriangle}
          warn={sessionFailed > 0}
        />
        <StatCard
          label="P95 latency"
          value={formatMs(metrics.totals.p95Ms)}
          sub={`p50 ${formatMs(metrics.totals.p50Ms)} · ttfb ${formatMs(metrics.totals.avgTtfbMs)}`}
          icon={Timer}
        />
      </div>

      {windowTruncated && (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-[11px] text-muted">
          Showing the last {exchanges.size} of {requestCount} requests. Totals above cover
          the whole session; domain and latency breakdowns cover the visible window only.
        </p>
      )}

      <section aria-label="Throughput" className="rounded-lg border border-line bg-surface p-3.5">
        <div className="flex items-baseline justify-between pb-2">
          <h2 className="text-[12px] font-medium text-txt">Downloaded over time</h2>
          <span className="font-mono text-[10px] tabular-nums text-muted">
            {formatTime(first.t0)} → {formatTime(last.t0)}
          </span>
        </div>
        <div className="h-24">
          <BucketBars
            values={buckets.map((b) => b.bytesIn)}
            label="Downloaded bytes per time bucket"
          />
        </div>
      </section>

      <section aria-label="Top domains" className="rounded-lg border border-line bg-surface">
        <h2 className="px-3.5 pb-1 pt-3 text-[12px] font-medium text-txt">Top domains</h2>
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-wider text-muted/80">
              <tr>
                <th className="px-3.5 py-1.5 font-medium">Domain</th>
                <th className="px-2 py-1.5 text-right font-medium">Reqs</th>
                <th className="px-2 py-1.5 text-right font-medium">Failed</th>
                <th className="px-2 py-1.5 text-right font-medium">Down</th>
                <th className="px-2 py-1.5 text-right font-medium">Up</th>
                <th className="px-3.5 py-1.5 text-right font-medium">P95</th>
              </tr>
            </thead>
            <tbody>
              {byDomain.map((d) => (
                <tr key={d.host} className="border-t border-line/50">
                  <td className="max-w-[220px] truncate px-3.5 py-1.5 font-mono text-txt">
                    {d.host}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted">
                    {d.count}
                  </td>
                  <td
                    className={clsx(
                      "px-2 py-1.5 text-right font-mono tabular-nums",
                      d.failed > 0 ? "text-warn" : "text-muted",
                    )}
                  >
                    {d.failed}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-txt">
                    {formatBytes(d.wireBytesIn)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted">
                    {formatBytes(d.bytesOut)}
                  </td>
                  <td className="px-3.5 py-1.5 text-right font-mono tabular-nums text-muted">
                    {formatMs(d.p95Ms)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Slowest requests" className="rounded-lg border border-line bg-surface">
        <h2 className="px-3.5 pb-1 pt-3 text-[12px] font-medium text-txt">Slowest requests</h2>
        <ul className="pb-1.5">
          {slowest.map((exchange) => (
            <li key={exchange.id}>
              <button
                type="button"
                onClick={() => requestSelect(exchange.id)}
                title="Open in Requests"
                className="focus-ring flex w-full items-center gap-2 px-3.5 py-1 text-left text-[12px] transition-colors hover:bg-surface-2/60"
              >
                <span
                  className={clsx(
                    "w-11 shrink-0 rounded px-1 py-px text-center font-mono text-[10px] font-medium",
                    methodClass(exchange.request.method),
                  )}
                >
                  {exchange.request.method}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-txt/90">
                  {exchange.request.path}
                  <span className="ml-1.5 text-muted">{exchange.request.host}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                  {formatMs(exchange.timing.total_ms)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Snapshots" className="rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between px-3.5 pb-1 pt-3">
          <h2 className="text-[12px] font-medium text-txt">Snapshots</h2>
          <Button
            variant="ghost"
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
        <div className="flex flex-wrap items-center gap-2 px-3.5 pb-2 text-[12px]">
          <span className="text-muted">Compare</span>
          <select
            value={compareA}
            onChange={(e) => setCompareA(e.target.value)}
            aria-label="Baseline snapshot"
            className="focus-ring rounded border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-txt"
          >
            <option value={CURRENT_OPTION}>Current session</option>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="text-muted">vs</span>
          <select
            value={compareB}
            onChange={(e) => setCompareB(e.target.value)}
            aria-label="Comparison snapshot"
            className="focus-ring rounded border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-txt"
          >
            <option value="">Pick a snapshot</option>
            <option value={CURRENT_OPTION}>Current session</option>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {comparison != null && (
          <div className="border-t border-line/50">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-muted/80">
                <tr>
                  <th className="px-3.5 py-1.5 font-medium">Domain</th>
                  <th className="px-2 py-1.5 text-right font-medium">A</th>
                  <th className="px-2 py-1.5 text-right font-medium">B</th>
                  <th className="px-2 py-1.5 text-right font-medium">Δ Down</th>
                  <th className="px-2 py-1.5 text-right font-medium">Δ Reqs</th>
                </tr>
              </thead>
              <tbody>
                {comparison.domains.slice(0, 15).map((row) => (
                  <tr key={row.host} className="border-t border-line/50">
                    <td className="max-w-[200px] truncate px-3.5 py-1.5 font-mono text-txt/90">
                      {row.host}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted">
                      {formatBytes(row.a?.wireBytesIn ?? 0)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted">
                      {formatBytes(row.b?.wireBytesIn ?? 0)}
                    </td>
                    <td
                      className={clsx(
                        "px-2 py-1.5 text-right font-mono tabular-nums",
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
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted">
                      {row.deltaCount >= 0 ? "+" : "−"}
                      {Math.abs(row.deltaCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {comparison.domains.length > 15 && (
              <p className="px-3.5 py-1.5 text-[11px] text-muted">
                +{comparison.domains.length - 15} more domains
              </p>
            )}
            <p className="border-t border-line/50 px-3.5 py-2 text-[11px] text-muted">
              Totals Δ: down {signedBytes(comparison.totals.wireBytesIn)} · up{" "}
              {signedBytes(comparison.totals.bytesOut)} · reqs{" "}
              {signedNumber(comparison.totals.count)} · failed{" "}
              {signedNumber(comparison.totals.failed)} · p95{" "}
              {comparison.totals.p95DeltaMs == null
                ? "n/a"
                : signedMs(comparison.totals.p95DeltaMs)}
            </p>
          </div>
        )}
        {snapshots.length > 0 && (
          <ul className="border-t border-line/50 pb-1.5">
            {snapshots.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-3.5 py-1.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate font-mono text-txt/90">{s.label}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                  {s.coverage.total} reqs · {formatBytes(s.totals.wireBytesIn)}
                </span>
                <button
                  type="button"
                  onClick={() => deleteSnapshot(s.id)}
                  aria-label={`Delete snapshot ${s.label}`}
                  title={`Delete snapshot ${s.label}`}
                  className="focus-ring grid size-6 place-items-center rounded text-muted transition-colors hover:bg-surface-2/60 hover:text-txt"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {snapshots.length === 0 && (
          <p className="border-t border-line/50 px-3.5 py-2 text-[11px] text-muted">
            Save a snapshot of the current session, then capture again and compare the two.
          </p>
        )}
      </section>
    </div>
  );
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
