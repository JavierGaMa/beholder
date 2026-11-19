import { create } from "zustand";

interface ShortcutsState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useShortcuts = create<ShortcutsState>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
}));
