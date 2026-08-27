import type { ReactNode } from "react";
import clsx from "clsx";

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-md border border-line bg-surface", className)}>{children}</div>;
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
    muted: "bg-surface-2 text-muted border-line",
    ok: "bg-surface-2 text-ok border-line",
    warn: "bg-surface-2 text-warn border-line",
    danger: "bg-surface-2 text-danger border-line",
    accent: "bg-surface-2 text-accent border-line",
  } as const;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none",
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
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={clsx(
        "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted transition-colors",
        "hover:bg-surface-2 hover:text-txt",
        active && "bg-surface-2 text-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-sm text-muted">{title}</p>
      {hint && <p className="text-xs text-muted/70">{hint}</p>}
    </div>
  );
}
