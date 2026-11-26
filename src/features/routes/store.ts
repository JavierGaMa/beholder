import { create } from "zustand";
import { invoke } from "../../lib/tauri";
import { loadEnabledRoutes, saveEnabledRoutes } from "../../lib/prefs";
import { toast } from "../../components/ui/toast";
import { enableRoutes, withRoutesEnabled } from "./routes";
import type { RouteFileStatus } from "../../store/types";

interface RoutesState {
  enabled: string[];
  setEnabled: (key: string, on: boolean, files?: RouteFileStatus[]) => void;
  enableAll: (files: RouteFileStatus[]) => void;
  reconcile: (files: RouteFileStatus[]) => void;
  disableAll: () => void;
  sync: () => void;
}

function push(command: string, args: Record<string, unknown>) {
  invoke(command, args).catch((e) => toast(`Could not update routes: ${String(e)}`, "danger"));
}

export const useRoutes = create<RoutesState>((set, get) => {
  function persist(enabled: string[]) {
    saveEnabledRoutes(enabled);
    set({ enabled });
  }
  function apply(next: string[]) {
    const previous = get().enabled;
    const off = previous.filter((key) => !next.includes(key));
    const on = next.filter((key) => !previous.includes(key));
    if (off.length === 0 && on.length === 0) return off;
    persist(next);
    for (const key of off) push("set_route_enabled", { key, enabled: false });
    for (const key of on) push("set_route_enabled", { key, enabled: true });
    return off;
  }
  function notifyReplaced(off: string[]) {
    if (off.length === 0) return;
    const names = off.map((key) => key.split("::").pop()).join(", ");
    toast(`Disabled ${names}: another route uses the same prefix`);
  }
  return {
    enabled: loadEnabledRoutes(),
    setEnabled: (key, on, files = []) => {
      if (!on) {
        apply(withRoutesEnabled(get().enabled, [key], false));
        return;
      }
      notifyReplaced(apply(enableRoutes(get().enabled, files, [key])));
    },
    enableAll: (files) => {
      const keys = files.flatMap((f) => f.routes.map((r) => r.key));
      apply(enableRoutes(get().enabled, files, keys, "keep"));
    },
    reconcile: (files) => {
      const current = get().enabled;
      const keys = files.flatMap((f) => f.routes.map((r) => r.key));
      const unknown = current.filter((key) => !keys.includes(key));
      const known = keys.filter((key) => current.includes(key));
      const kept = enableRoutes(unknown, files, known, "keep");
      notifyReplaced(apply(current.filter((key) => kept.includes(key))));
    },
    disableAll: () => {
      persist([]);
      push("set_all_routes_enabled", { enabled: false });
    },
    sync: () => {
      for (const key of get().enabled) push("set_route_enabled", { key, enabled: true });
    },
  };
});
