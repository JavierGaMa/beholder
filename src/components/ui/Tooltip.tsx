import { Children, cloneElement, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import clsx from "clsx";

type TooltipChildProps = {
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
};

export type TooltipProps = {
  label: string;
  children: ReactElement<TooltipChildProps>;
  side?: "top" | "bottom";
  delayMs?: number;
};

export function Tooltip({ label, children, side = "top", delayMs = 300 }: TooltipProps) {
  const [show, setShow] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function enter() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShow(true), delayMs);
  }

  function leave() {
    window.clearTimeout(timer.current);
    setShow(false);
  }

  const child = Children.only(children);
  return (
    <span className="relative inline-flex">
      {cloneElement(child, {
        onMouseEnter: () => {
          child.props.onMouseEnter?.();
          enter();
        },
        onMouseLeave: () => {
          child.props.onMouseLeave?.();
          leave();
        },
        onFocus: () => {
          child.props.onFocus?.();
          setShow(true);
        },
        onBlur: () => {
          child.props.onBlur?.();
          leave();
        },
      })}
      {show && (
        <span
          role="tooltip"
          className={clsx(
            "anim-overlay-fade pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap",
            "rounded-[var(--radius-sm)] border border-line bg-surface-2 px-2 py-1 text-[11px] text-txt shadow-[var(--shadow-2)]",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
