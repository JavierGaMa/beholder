import { Children, cloneElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
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

const BUBBLE_MARGIN = 8;
const EST_BUBBLE_HEIGHT = 28;

export function Tooltip({ label, children, side = "top", delayMs = 300 }: TooltipProps) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; flipped: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!show) return;
    const place = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const flipped = side === "top" && r.top < EST_BUBBLE_HEIGHT + BUBBLE_MARGIN + 4;
      setPos({
        left: r.left + r.width / 2,
        top: flipped ? r.bottom + BUBBLE_MARGIN : r.top - BUBBLE_MARGIN,
        flipped,
      });
    };
    place();
    const close = () => setShow(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, { passive: true, capture: true });
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, { capture: true } as EventListenerOptions);
    };
  }, [show, side]);

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
    <span ref={wrapRef} className="relative inline-flex">
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
      {show &&
        pos &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              transform: pos.flipped ? "translate(-50%, 0)" : "translate(-50%, -100%)",
            }}
            className={clsx(
              "anim-overlay-fade pointer-events-none z-50 whitespace-nowrap",
              "rounded-[var(--radius-sm)] border border-line bg-surface-2 px-2 py-1 text-[11px] text-txt shadow-[var(--shadow-2)]",
            )}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
