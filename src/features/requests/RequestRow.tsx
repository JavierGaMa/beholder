import type { CSSProperties } from "react";
import clsx from "clsx";
import type { HttpExchange } from "../../store/types";
import { formatBytes, formatMs, methodClass, statusClass } from "../../lib/format";
import { Badge } from "../../components/ui/primitives";

export function RequestRow({
  ex,
  selected,
  flash,
  slowMs,
  onSelect,
  style,
}: {
  ex: HttpExchange;
  selected: boolean;
  flash: boolean;
  slowMs: number;
  onSelect: () => void;
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
      className={clsx(
        "flex cursor-default items-center gap-3 border-b border-line/50 px-3 font-mono text-[12px] leading-[34px] transition-colors",
        selected ? "bg-surface-2 text-txt" : "text-muted hover:bg-surface/80",
        failed && !selected && "border-l-2 border-l-danger",
        flash && "animate-pulse bg-accent/5",
      )}
    >
      <span className={clsx("w-12 shrink-0 font-semibold", methodClass(ex.request.method))}>
        {ex.request.method}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className={clsx(selected ? "text-txt" : "text-txt/90")}>{ex.request.host}</span>
        <span className="text-muted">{ex.request.path}</span>
      </span>
      {ex.error ? (
        <Badge tone="danger">ERR</Badge>
      ) : (
        <Badge tone={statusClass(status)}>{status ?? "…"}</Badge>
      )}
      <span
        className={clsx(
          "w-16 shrink-0 text-right",
          slow && (total! > slowMs * 4 ? "text-danger" : "text-warn"),
        )}
      >
        {formatMs(total)}
      </span>
      <span className="w-20 shrink-0 text-right">{formatBytes(size)}</span>
    </div>
  );
}
