import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { AlertCircle, Minus, Plus } from "lucide-react";
import { useConsole } from "../../store/console";
import { useTraffic } from "../../store/traffic";
import { EmptyState } from "../../components/ui/primitives";
import { formatMs, methodClass } from "../../lib/format";
import type { TimelineItem } from "./timeline";
import { buildTimeline } from "./timeline";
import { timeOf } from "./rows";
import { LEVEL_LETTER, levelCls } from "./LogRow";

function TimelineLogRow({ item }: { item: Extract<TimelineItem, { kind: "log" }> }) {
  const { line, at } = item;
  return (
    <div
      className={clsx(
        "flex items-center gap-2 border-b border-line/40 px-3 py-0.5 font-mono text-[length:var(--mono-size,12px)] leading-5",
        line.is_crash ? "bg-danger/10" : "hover:bg-surface/60",
      )}
    >
      <span className="w-[86px] shrink-0 tabular-nums text-muted/80">{timeOf(at)}</span>
      <span className={clsx("w-3 shrink-0 text-center font-bold", levelCls(line.level))}>
        {LEVEL_LETTER[line.level]}
      </span>
      <span className="w-28 shrink-0 truncate text-accent" title={line.tag}>
        {line.tag}
      </span>
      <span className="min-w-0 flex-1 truncate whitespace-pre text-txt/90" title={line.message}>
        {line.message.split("\n")[0]}
        {line.repeat_count > 1 && (
          <span className="ml-2 rounded border border-line px-1 text-[10px] leading-4 text-muted">
            × {line.repeat_count}
          </span>
        )}
      </span>
    </div>
  );
}

function TimelineGapRow({ item }: { item: Extract<TimelineItem, { kind: "gap" }> }) {
  return (
    <div className="flex items-center border-b border-line/40 bg-surface px-3 py-0.5 font-mono text-[11px] italic text-muted/70">
      ··· {item.dropped} lines dropped while paused ···
    </div>
  );
}

function statusCls(status: number): string {
  if (status < 300) return "text-ok";
  if (status < 400) return "text-warn";
  return "text-danger";
}

function TimelineExchangeRow({
  item,
  onSelect,
}: {
  item: Extract<TimelineItem, { kind: "exchange" }>;
  onSelect: (id: number) => void;
}) {
  const ex = item.exchange;
  const status = ex.response?.status ?? null;
  return (
    <button
      type="button"
      onClick={() => onSelect(ex.id)}
      title="Open in Requests view"
      className="flex w-full cursor-pointer items-center gap-2 border-b border-line/40 px-3 py-0.5 text-left font-mono text-[length:var(--mono-size,12px)] leading-5 hover:bg-surface/60"
    >
      <span className="w-[86px] shrink-0 tabular-nums text-muted/80">{timeOf(item.at)}</span>
      <span className={clsx("w-14 shrink-0 text-[11px] font-bold tracking-wide", methodClass(ex.request.method))}>
        {ex.request.method}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="text-accent">{ex.request.host}</span>
        <span className="text-muted">{ex.request.path}</span>
      </span>
      {ex.error != null ? (
        <span className="flex w-40 shrink-0 items-center justify-end gap-1 truncate text-danger" title={ex.error}>
          <AlertCircle size={12} className="shrink-0" />
          <span className="truncate">{ex.error}</span>
        </span>
      ) : status == null ? (
        <span className="w-8 shrink-0 animate-pulse text-center text-muted">·</span>
      ) : (
        <span className={clsx("w-8 shrink-0 text-center font-semibold", statusCls(status))}>{status}</span>
      )}
      <span className="w-16 shrink-0 text-right tabular-nums text-muted/80">{formatMs(ex.timing.total_ms)}</span>
    </button>
  );
}

export function TimelineView() {
  const entries = useConsole((s) => s.lines);
  const exchanges = useTraffic((s) => s.exchanges);
  const order = useTraffic((s) => s.order);
  const requestSelect = useTraffic((s) => s.requestSelect);
  const [skew, setSkew] = useState(0);

  const items = useMemo(() => buildTimeline(entries, exchanges, order, skew), [entries, exchanges, order, skew]);

  const counts = useMemo(() => {
    let logs = 0;
    let requests = 0;
    for (const item of items) {
      if (item.kind === "log") logs += 1;
      else if (item.kind === "exchange") requests += 1;
    }
    return { logs, requests };
  }, [items]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 12,
  });

  const stick = useRef(true);
  const prevCount = useRef(0);

  function onScroll() {
    const el = parentRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  useEffect(() => {
    if (items.length === prevCount.current) return;
    prevCount.current = items.length;
    if (!stick.current) return;
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(items.length - 1, { align: "end" });
    });
  }, [items.length, virtualizer]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line bg-surface px-3 py-1">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
          <span>clock skew (ms)</span>
          <span className="flex h-6 items-center rounded-md border border-line bg-bg">
            <button
              type="button"
              title="Decrease skew by 1 ms"
              onClick={() => setSkew((s) => s - 1)}
              className="flex h-full w-5 items-center justify-center text-muted hover:text-accent"
            >
              <Minus size={10} />
            </button>
            <input
              type="number"
              value={skew}
              onChange={(e) => setSkew(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)}
              className="h-6 w-16 border-x border-line bg-transparent text-center tabular-nums text-txt focus:outline-none"
            />
            <button
              type="button"
              title="Increase skew by 1 ms"
              onClick={() => setSkew((s) => s + 1)}
              className="flex h-full w-5 items-center justify-center text-muted hover:text-accent"
            >
              <Plus size={10} />
            </button>
          </span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted/70">
          {counts.logs} logs · {counts.requests} requests
        </span>
      </div>
      <div ref={parentRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
        {items.length === 0 ? (
          <EmptyState
            title="Timeline is empty"
            hint="Stream console logs or capture traffic to see merged entries"
          />
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const item = items[vi.index];
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  {item.kind === "log" ? (
                    <TimelineLogRow item={item} />
                  ) : item.kind === "gap" ? (
                    <TimelineGapRow item={item} />
                  ) : (
                    <TimelineExchangeRow item={item} onSelect={requestSelect} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
