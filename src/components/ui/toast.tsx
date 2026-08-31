import { create } from "zustand";
import clsx from "clsx";

export type ToastTone = "accent" | "warn" | "danger";

interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

interface ToastState {
  items: ToastItem[];
  push: (text: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (text, tone = "accent") => {
    const id = nextId++;
    set((s) => ({ items: [...s.items.slice(-3), { id, text, tone }] }));
    setTimeout(() => {
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
    }, 3500);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export function toast(text: string, tone?: ToastTone) {
  useToasts.getState().push(text, tone);
}

export function Toaster() {
  const items = useToasts((s) => s.items);
  if (items.length === 0) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-12 right-4 z-50 flex flex-col items-end gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={clsx(
            "rounded-md border bg-surface-2 px-3 py-1.5 font-mono text-[11px] shadow-xl",
            t.tone === "accent" && "border-line text-txt",
            t.tone === "warn" && "border-warn/50 text-warn",
            t.tone === "danger" && "border-danger/50 text-danger",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
