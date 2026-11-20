import { useCallback, useRef } from "react";
import { Keyboard } from "lucide-react";
import { useOverlayFocus } from "../../components/ui/useOverlayFocus";
import { SHORTCUT_GROUPS } from "./shortcuts";
import { useShortcuts } from "./store";

export function ShortcutsOverlay() {
  const open = useShortcuts((s) => s.open);
  const close = useCallback(() => useShortcuts.getState().setOpen(false), []);
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayFocus(open, close, panelRef);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center px-4 pt-[10vh]">
      <div className="anim-overlay-fade absolute inset-0 bg-black/40" onClick={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="anim-pop-in relative flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-bg shadow-[var(--shadow-3)] outline-none"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <Keyboard size={14} className="shrink-0 text-muted" />
          <span className="text-[12px] font-medium text-txt">Keyboard shortcuts</span>
          <kbd className="ml-auto shrink-0 rounded border border-line px-1 py-px font-mono text-[9px] leading-none text-muted/60">
            esc
          </kbd>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.label} role="group" aria-label={group.label} className="mb-3 last:mb-0">
              <p className="px-1 pb-1.5 text-[11px] font-semibold text-muted">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.entries.map((entry) => (
                  <div
                    key={`${group.label}-${entry.keys}-${entry.description}`}
                    className="flex items-center justify-between gap-4 rounded-md px-1.5 py-1 hover:bg-surface-2"
                  >
                    <span className="text-[12px] text-txt">{entry.description}</span>
                    <kbd className="shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted">
                      {entry.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
