import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export type PaneGrowDirection = "up" | "down" | "left" | "right";

export interface PaneResizeHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

export function usePaneResize(args: {
  grow: PaneGrowDirection;
  getSize: () => number;
  clamp: (candidate: number) => number;
  onResized: (next: number) => void;
}): PaneResizeHandlers {
  const drag = useRef<{ startClient: number; startSize: number } | null>(null);
  const isHorizontal = args.grow === "left" || args.grow === "right";
  const growsWithPositiveDelta = args.grow === "down" || args.grow === "right";
  return {
    onPointerDown: (e) => {
      drag.current = {
        startClient: isHorizontal ? e.clientX : e.clientY,
        startSize: args.getSize(),
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      const start = drag.current;
      if (start == null) return;
      const client = isHorizontal ? e.clientX : e.clientY;
      const delta = client - start.startClient;
      const raw = growsWithPositiveDelta ? start.startSize + delta : start.startSize - delta;
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
