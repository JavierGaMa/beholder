import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

export type DropdownPositionOpts = {
  width: number;
  estHeight: number;
  margin?: number;
  gap?: number;
};

const DEFAULT_MARGIN = 8;
const DEFAULT_GAP = 8;
const HIDDEN_STYLE: CSSProperties = { position: "fixed", top: 0, left: 0, visibility: "hidden" };

export function computeDropdownStyle(
  anchor: DOMRect,
  viewportW: number,
  viewportH: number,
  opts: DropdownPositionOpts,
): { style: CSSProperties } {
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const gap = opts.gap ?? DEFAULT_GAP;
  const spaceBelow = viewportH - margin - (anchor.bottom + gap);
  const spaceAbove = anchor.top - gap - margin;
  const fitsBelow = anchor.bottom + gap + opts.estHeight <= viewportH - margin;

  let top: number;
  let maxHeight: number;
  if (fitsBelow || spaceBelow >= spaceAbove) {
    top = anchor.bottom + gap;
    maxHeight = spaceBelow;
  } else {
    top = Math.max(margin, anchor.top - gap - opts.estHeight);
    maxHeight = anchor.top - gap - top;
  }

  let left = anchor.left;
  if (left + opts.width > viewportW - margin) {
    const rightEdge = Math.min(anchor.right, viewportW - margin);
    left = rightEdge - opts.width;
  }
  left = Math.max(margin, left);

  return {
    style: {
      position: "fixed",
      top,
      left,
      width: opts.width,
      maxHeight: Math.max(0, maxHeight),
    },
  };
}

export function useDropdownPosition(open: boolean, opts: DropdownPositionOpts) {
  const { width, estHeight, margin, gap } = opts;
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>(HIDDEN_STYLE);

  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const measured = menuRef.current?.offsetHeight ?? 0;
      const next = computeDropdownStyle(anchor, window.innerWidth, window.innerHeight, {
        width,
        estHeight: measured > 0 ? measured : estHeight,
        margin,
        gap,
      }).style;
      setStyle((cur) => (samePosition(cur, next) ? cur : next));
    };
    place();
    raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
    };
  }, [open, width, estHeight, margin, gap]);

  return { anchorRef, menuRef, style };
}

function samePosition(a: CSSProperties, b: CSSProperties): boolean {
  return (
    a.top === b.top && a.left === b.left && a.width === b.width && a.maxHeight === b.maxHeight
  );
}
