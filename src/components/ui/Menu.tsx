import { useEffect, useRef, useState } from "react";
import type {
  ComponentType,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  Ref,
  RefObject,
} from "react";
import clsx from "clsx";
import { useDropdownPosition } from "./popover";
import { nextMenuIndex } from "./menuNav";

export type MenuIcon = ComponentType<{ size?: number; className?: string }>;

export interface MenuOption {
  key: string;
  label: string;
  icon?: MenuIcon;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

export type MenuTriggerProps = {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
};

export type MenuProps = {
  items: MenuOption[];
  onClose: () => void;
  width?: number;
  trigger?: (props: MenuTriggerProps) => ReactNode;
  x?: number;
  y?: number;
  className?: string;
};

function clampedStyle(x: number, y: number, width: number, estHeight: number) {
  return {
    position: "fixed" as const,
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - estHeight - 8)),
    width,
  };
}

export function Menu({ items, onClose, trigger, x, y, width = 208, className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const estHeight = items.length * 30 + 8;
  const { anchorRef, menuRef, style } = useDropdownPosition(open, {
    width,
    estHeight,
  });

  if (trigger) {
    const close = () => {
      setOpen(false);
      onClose();
    };
    return (
      <>
        <span ref={wrapperRef} className="relative inline-flex">
          {trigger({
            ref: anchorRef,
            onClick: () => setOpen((o) => !o),
            "aria-haspopup": "menu",
            "aria-expanded": open,
          })}
        </span>
        {open && (
          <MenuList
            items={items}
            onClose={close}
            menuRef={menuRef}
            style={style}
            restoreFocusTo={anchorRef.current}
            ignoreClickRef={wrapperRef}
            className={className}
          />
        )}
      </>
    );
  }

  if (x === undefined || y === undefined) return null;
  return (
    <MenuList items={items} onClose={onClose} style={clampedStyle(x, y, width, estHeight)} className={className} />
  );
}

function MenuList({
  items,
  onClose,
  restoreFocusTo,
  ignoreClickRef,
  menuRef,
  style,
  className,
}: {
  items: MenuOption[];
  onClose: () => void;
  restoreFocusTo?: HTMLElement | null;
  ignoreClickRef?: RefObject<HTMLSpanElement | null>;
  menuRef?: RefObject<HTMLDivElement | null>;
  style: React.CSSProperties;
  className?: string;
}) {
  const localRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = localRef.current;
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const firstEnabled = buttons.find((b) => !b.disabled);
    firstEnabled?.focus();
  }, []);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (localRef.current?.contains(target)) return;
      if (ignoreClickRef?.current?.contains(target)) return;
      onClose();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onBlur() {
      onClose();
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
      window.removeEventListener("blur", onBlur);
    };
  }, [onClose, ignoreClickRef]);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const container = localRef.current;
    if (!container) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      restoreFocusTo?.focus();
      onClose();
      return;
    }
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const enabled = buttons.map((b) => !b.disabled);
    const current = buttons.findIndex((b) => b === document.activeElement);
    const next = nextMenuIndex(e.key, current, enabled);
    if (next !== current && next >= 0) {
      e.preventDefault();
      buttons[next]?.focus();
    }
  }

  function setRef(el: HTMLDivElement | null) {
    localRef.current = el;
    if (menuRef) menuRef.current = el;
  }

  return (
    <div
      ref={setRef}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={style}
      className={clsx(
        "anim-pop-in fixed z-50 overflow-y-auto rounded-[var(--radius-md)] border border-line bg-surface-2 p-1 shadow-[var(--shadow-3)] outline-none",
        className,
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={clsx(
              "flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[12px]",
              "transition-colors [transition-duration:var(--dur-fast)] focus:outline-none",
              item.danger
                ? "text-danger hover:bg-danger/10 focus:bg-danger/10"
                : "text-txt/90 hover:bg-surface focus:bg-surface",
              item.disabled && "pointer-events-none opacity-40",
            )}
          >
            {Icon ? (
              <Icon size={14} className={item.danger ? "text-danger/70" : "text-muted"} />
            ) : (
              <span className="w-3.5" />
            )}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
