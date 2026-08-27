import { useEffect, useRef } from "react";
import type { ComponentType } from "react";
import clsx from "clsx";

export interface MenuItem {
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onEsc);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onEsc);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 40 - items.length * 30),
  };

  return (
    <div
      ref={ref}
      style={style}
      className="fixed z-50 min-w-52 overflow-hidden rounded-md border border-line bg-surface-2 py-1 shadow-xl"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={clsx(
              "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] text-txt/90 transition-colors hover:bg-surface",
              item.danger && "text-danger",
              item.disabled && "cursor-default opacity-40 hover:bg-transparent",
            )}
          >
            {Icon ? <Icon size={13} className="text-muted" /> : <span className="w-[13px]" />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
