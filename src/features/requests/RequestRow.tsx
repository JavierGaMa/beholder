import type { CSSProperties } from "react";
import clsx from "clsx";
import { AlertCircle } from "lucide-react";
import type { HttpExchange } from "../../store/types";
import { formatBytes, formatMs, methodClass } from "../../lib/format";

function statusTextCls(status: number | null): string {
  if (status == null) return "text-muted";
  if (status < 300) return "text-ok";
  if (status < 400) return "text-warn";
  return "text-danger";
}

export function RequestRow({
  ex,
  selected,
  flash,
  slowMs,
  onSelect,
  onContextMenu,
  style,
}: {
  ex: HttpExchange;
  selected: boolean;
  flash: boolean;
  slowMs: number;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  style: CSSProperties;
}) {
  const status = ex.response?.status ?? null;
  const size = ex.response?.body?.size ?? ex.request.body?.size ?? null;
  const total = ex.timing.total_ms;
  const failed = ex.error != null || (status != null && status >= 400);
  const slow = total != null && total > slowMs;
  return (
    <div
      style={style}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={clsx(
        "flex cursor-default items-center gap-2 border-b border-line/40 px-3 font-mono text-[12px] leading-[34px] tabular-nums transition-colors",
        selected ? "bg-surface-2 text-txt" : "text-muted hover:bg-surface/80",
        failed && !selected && "border-l-2 border-l-danger",
        flash && "animate-pulse bg-accent/5",
      )}
    >
      <span className={clsx("w-14 shrink-0 text-[11px] font-bold tracking-wide", methodClass(ex.request.method))}>
        {ex.request.method}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className={clsx(selected ? "text-txt" : "text-txt/85")}>{ex.request.host}</span>
        <span className="text-muted">{ex.request.path}</span>
      </span>
      {ex.error ? (
        <AlertCircle size={13} className="w-8 shrink-0 text-danger" />
      ) : status == null ? (
        <span className="w-8 shrink-0 animate-pulse text-center text-muted">·</span>
      ) : (
        <span className={clsx("w-8 shrink-0 text-center font-semibold", statusTextCls(status))}>{status}</span>
      )}
      <span
        className={clsx(
          "w-16 shrink-0 text-right",
          slow && (total! > slowMs * 4 ? "font-semibold text-danger" : "text-warn"),
        )}
      >
        {formatMs(total)}
      </span>
      <span className="w-20 shrink-0 text-right text-muted/80">{formatBytes(size)}</span>
    </div>
  );
}

export function RequestListHeader() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted/60">
      <span className="w-14 shrink-0">Method</span>
      <span className="min-w-0 flex-1">Host / Path</span>
      <span className="w-8 shrink-0 text-center">St</span>
      <span className="w-16 shrink-0 text-right">Time</span>
      <span className="w-20 shrink-0 text-right">Size</span>
    </div>
  );
}
