import { create } from "zustand";

interface DeviceWizardState {
  serial: string | null;
  seen: ReadonlySet<string>;
  open: (serial: string) => void;
  openFirstTime: (serial: string) => void;
  close: () => void;
}

export const useDeviceWizard = create<DeviceWizardState>((set, get) => ({
  serial: null,
  seen: new Set(),
  open: (serial) => set((s) => ({ serial, seen: new Set(s.seen).add(serial) })),
  openFirstTime: (serial) => {
    if (!get().seen.has(serial)) get().open(serial);
  },
  close: () => set({ serial: null }),
}));
