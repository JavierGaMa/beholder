import { useRef } from "react";
import clsx from "clsx";
import { useOverlayFocus } from "./useOverlayFocus";

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  ariaLabel?: string;
  className?: string;
};

export function Drawer({ open, onClose, children, width = 384, ariaLabel, className }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayFocus(open, onClose, panelRef);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="anim-overlay-fade absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{ width }}
        className={clsx(
          "anim-slide-in-right absolute inset-y-0 right-0 flex max-w-full flex-col overflow-y-auto",
          "border-l border-line bg-bg shadow-[var(--shadow-3)] outline-none",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
