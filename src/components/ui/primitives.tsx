import type { ReactNode } from "react";
import clsx from "clsx";
import { Button } from "./Button";

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        "rounded-[var(--radius-md)] border border-line bg-surface shadow-[var(--shadow-1)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "muted" | "ok" | "warn" | "danger" | "accent";
  className?: string;
}) {
  const tones = {
    muted: "border-line bg-surface-2 text-muted",
    ok: "border-ok/25 bg-ok/10 text-ok",
    warn: "border-warn/25 bg-warn/10 text-warn",
    danger: "border-danger/25 bg-danger/10 text-danger",
    accent: "border-accent/25 bg-accent/10 text-accent",
  } as const;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function IconButton({
  children,
  onClick,
  title,
  active,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={clsx(active && "bg-surface-2 text-accent hover:bg-surface-2 hover:text-accent", className)}
    >
      {children}
    </Button>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
      {icon && (
        <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted">
          {icon}
        </span>
      )}
      <p className="text-sm text-muted">{title}</p>
      {hint && <p className="text-xs text-muted/70">{hint}</p>}
    </div>
  );
}
