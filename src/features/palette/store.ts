import { create } from "zustand";
import { nextMenuIndex } from "../../components/ui/menuNav";

export const MAX_RECENT = 5;

interface PaletteState {
  open: boolean;
  query: string;
  activeIndex: number;
  recent: string[];
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setQuery: (q: string) => void;
  setActiveIndex: (i: number) => void;
  moveActive: (key: string, count: number) => void;
  recordRun: (id: string) => void;
}

export const usePalette = create<PaletteState>((set, get) => ({
  open: false,
  query: "",
  activeIndex: 0,
  recent: [],
  setOpen: (open) =>
    set(open ? { open: true, query: "", activeIndex: 0 } : { open: false }),
  toggle: () => get().setOpen(!get().open),
  setQuery: (q) => set({ query: q, activeIndex: 0 }),
  setActiveIndex: (i) => set({ activeIndex: i }),
  moveActive: (key, count) =>
    set((s) => ({
      activeIndex: nextMenuIndex(key, s.activeIndex, new Array(count).fill(true)),
    })),
  recordRun: (id) =>
    set((s) => ({
      recent: [id, ...s.recent.filter((r) => r !== id)].slice(0, MAX_RECENT),
    })),
}));
