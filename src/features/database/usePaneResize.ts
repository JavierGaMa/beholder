import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export type PaneAxis = "x" | "y";

export interface PaneResizeHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

export function usePaneResize(args: {
  axis: PaneAxis;
  getSize: () => number;
  clamp: (candidate: number) => number;
  onResized: (next: number) => void;
}): PaneResizeHandlers {
  const drag = useRef<{ startClient: number; startSize: number } | null>(null);
  return {
    onPointerDown: (e) => {
      drag.current = {
        startClient: args.axis === "x" ? e.clientX : e.clientY,
        startSize: args.getSize(),
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      const start = drag.current;
      if (start == null) return;
      const raw =
        args.axis === "x"
          ? start.startSize + (e.clientX - start.startClient)
          : start.startSize - (e.clientY - start.startClient);
      args.onResized(args.clamp(raw));
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
  };
}
