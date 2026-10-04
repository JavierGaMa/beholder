import { useRef } from "react";
import clsx from "clsx";
import { useOverlayFocus } from "./useOverlayFocus";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  ariaLabel?: string;
  className?: string;
};

export function Modal({ open, onClose, children, width, ariaLabel, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayFocus(open, onClose, panelRef);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="anim-overlay-fade absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={width ? { width } : undefined}
        className={clsx(
          "anim-pop-in relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto",
          "rounded-[var(--radius-lg)] border border-line bg-bg shadow-[var(--shadow-3)] outline-none",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
