import type { ReactNode } from "react";
import clsx from "clsx";
import type { HttpExchange } from "../../store/types";
import { isFailed } from "./filters";
import { axisLabels, severity, tickClass, tickHeight, xFraction, type TimeWindow } from "./stripGeometry";

export function TimeStrip({
  rows,
  range,
  selectedId,
  onSelect,
  trailing,
}: {
  rows: HttpExchange[];
  range: TimeWindow;
  selectedId: number | null;
  onSelect: (id: number) => void;
  trailing?: ReactNode;
}) {
  const errors = rows.reduce((n, ex) => n + (isFailed(ex) ? 1 : 0), 0);
  const selected = selectedId != null ? rows.find((ex) => ex.id === selectedId) : undefined;
  return (
    <div className="shrink-0 border-b border-line px-4 pb-1.5 pt-3">
      <div className="flex min-w-0 items-center gap-3.5 text-[12px]">
        <span className="text-[13px] font-semibold text-txt">Last {range.seconds} seconds</span>
        <span className="min-w-0 truncate text-muted">
          {rows.length} requests, {errors} with errors
        </span>
        {trailing != null && (
          <>
            <span className="flex-1" />
            {trailing}
          </>
        )}
      </div>
      <div
        className="relative mt-2 h-[52px] bg-[repeating-linear-gradient(to_top,transparent_0_16px,color-mix(in_srgb,var(--line)_70%,transparent)_16px_17px)]"
        aria-label="Request timeline"
        role="group"
      >
        {rows.map((ex) => (
          <button
            key={ex.id}
            type="button"
            tabIndex={-1}
            title={`${ex.request.method} ${ex.request.host}${ex.request.path}`}
            onClick={() => onSelect(ex.id)}
            className={clsx(
              "absolute bottom-0 -ml-0.5 w-1 rounded-t-[2px] transition-opacity hover:opacity-100",
              tickClass(severity(ex)),
              ex.id === selectedId && "opacity-100",
            )}
            style={{ left: `${xFraction(ex.request.started_at, range) * 100}%`, height: `${tickHeight(ex) * 100}%` }}
          />
        ))}
        {selected && (
          <span
            className="pointer-events-none absolute -top-1 bottom-0 w-px bg-accent before:absolute before:-left-[3px] before:top-0 before:h-[7px] before:w-[7px] before:rounded-full before:bg-accent"
            style={{ left: `${xFraction(selected.request.started_at, range) * 100}%` }}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
        {axisLabels(range).map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
    </div>
  );
}
