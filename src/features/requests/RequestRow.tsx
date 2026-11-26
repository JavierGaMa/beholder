import type { CSSProperties } from "react";
import clsx from "clsx";
import type { HttpExchange } from "../../store/types";
import { formatBytes, formatMs } from "../../lib/format";
import { severity, waterfallBar, type Severity, type TimeWindow } from "./stripGeometry";

export const ROW_GRID = "grid grid-cols-[50px_58px_minmax(0,1fr)_72px_minmax(150px,230px)] items-center gap-2.5 px-2.5";

const BAR_CLASS: Record<Severity, string> = {
  normal: "bg-muted opacity-70",
  warn: "bg-warn",
  danger: "bg-danger",
};

export function StatusPill({ ex, failLabel = "fail", className }: { ex: HttpExchange; failLabel?: string; className?: string }) {
  const status = ex.response?.status ?? null;
  const sev = severity(ex);
  if (sev === "normal") {
    return <span className={clsx("justify-self-start px-1.5 text-muted", className)}>{status ?? "·"}</span>;
  }
  return (
    <span
      className={clsx(
        "justify-self-start rounded-[5px] px-1.5 font-semibold",
        sev === "warn" ? "bg-warn/15 text-warn" : "bg-danger/15 text-danger",
        className,
      )}
    >
      {status ?? failLabel}
    </span>
  );
}

export function RequestRow({
  ex,
  selected,
  flash,
  pinned,
  slowMs,
  hideDomain,
  range,
  onSelect,
  onContextMenu,
  style,
}: {
  ex: HttpExchange;
  selected: boolean;
  flash: boolean;
  pinned?: boolean;
  slowMs: number;
  hideDomain: boolean;
  range: TimeWindow;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  style: CSSProperties;
}) {
  const size = ex.response?.body?.size ?? ex.request.body?.size ?? null;
  const total = ex.timing.total_ms;
  const slow = total != null && total > slowMs;
  const bar = waterfallBar(ex, range);
  return (
    <div
      style={style}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      aria-selected={selected}
      className={clsx(
        ROW_GRID,
        "cursor-default rounded-lg font-mono text-[length:var(--mono-size,12px)] leading-[length:var(--row-h,32px)] tabular-nums transition-colors",
        selected ? "bg-accent/12 text-txt ring-1 ring-inset ring-accent/25" : "text-txt hover:bg-surface-2",
        flash && "anim-fade-flash",
      )}
    >
      <StatusPill ex={ex} className="leading-[18px]" />
      <span className="flex min-w-0 items-center gap-1.5 text-muted">
        {ex.request.method}
        {pinned && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0 truncate">
        {ex.request.routed && (
          <span
            title={ex.request.routed.target}
            className="mr-1.5 rounded-[5px] bg-accent/14 px-1.5 py-px text-[10px] font-semibold leading-4 text-accent"
          >
            local
          </span>
        )}
        {!hideDomain && <span className="text-muted">{ex.request.host}</span>}
        <span>{ex.request.path}</span>
      </span>
      <span className="text-right text-muted">{size == null ? "" : formatBytes(size)}</span>
      <span className="flex h-full min-w-0 items-center gap-2">
        <span className="relative h-full min-w-0 flex-1">
          <span className="absolute inset-x-0 top-1/2 border-t border-line/70" />
          {bar && (
            <span
              className={clsx("absolute top-1/2 h-2 min-w-[3px] -translate-y-1/2 rounded", BAR_CLASS[severity(ex)])}
              style={{ left: `${bar.left * 100}%`, width: `${bar.width * 100}%` }}
            />
          )}
        </span>
        <span className={clsx("w-14 shrink-0 text-right text-[11px]", slow ? "font-semibold text-warn" : "text-muted")}>
          {total == null ? "" : formatMs(total)}
        </span>
      </span>
    </div>
  );
}

export function RequestListHeader({ hideDomain }: { hideDomain?: boolean }) {
  return (
    <div className={clsx(ROW_GRID, "h-7 shrink-0 text-[11px] text-muted")}>
      <span>Status</span>
      <span>Method</span>
      <span>{hideDomain ? "Endpoint" : "Request"}</span>
      <span className="text-right">Size</span>
      <span>Timeline</span>
    </div>
  );
}
