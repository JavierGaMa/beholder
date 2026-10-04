import type { KeyboardEvent } from "react";
import clsx from "clsx";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

export type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  function move(from: number, dir: 1 | -1) {
    const n = options.length;
    for (let step = 1; step <= n; step++) {
      const idx = (from + dir * step + n * 2) % n;
      const next = options[idx];
      if (next && next.value !== value) {
        onChange(next.value);
        return;
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = options.findIndex((o) => o.value === value);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(current < 0 ? 0 : current, 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(current < 0 ? 0 : current, -1);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={clsx("inline-flex items-center rounded-[var(--radius-md)] bg-surface-2 p-0.5", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={clsx(
              "focus-ring h-6 rounded-[var(--radius-sm)] px-2.5 text-[11px] font-medium",
              "transition-colors [transition-duration:var(--dur-base)] disabled:pointer-events-none disabled:opacity-40",
              active ? "bg-surface text-txt shadow-[var(--shadow-1)]" : "text-muted hover:text-txt",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
