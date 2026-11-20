import type { ReactNode } from "react";
import clsx from "clsx";
import { Button } from "./Button";

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("panel", className)}>{children}</div>
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
    muted: "bg-muted/14 text-muted",
    ok: "bg-ok/14 text-ok",
    warn: "bg-warn/14 text-warn",
    danger: "bg-danger/14 text-danger",
    accent: "bg-accent/14 text-accent",
  } as const;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
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
    <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-1 p-8 text-center">
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
