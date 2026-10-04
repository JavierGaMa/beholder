import type { ButtonHTMLAttributes } from "react";
import clsx from "clsx";

export type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  count?: number;
};

export function Chip({ selected, count, className, children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected ?? false}
      className={clsx(
        "press focus-ring inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium",
        "transition-colors [transition-duration:var(--dur-fast)] disabled:pointer-events-none disabled:opacity-40",
        selected
          ? "border-accent/30 bg-accent/15 text-accent"
          : "border-line text-muted hover:border-muted/40 hover:text-txt",
        className,
      )}
      {...rest}
    >
      {children}
      {count !== undefined && (
        <span
          className={clsx(
            "rounded-full px-1 text-[10px] leading-4",
            selected ? "bg-accent/20 text-accent" : "bg-surface-2 text-muted",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
