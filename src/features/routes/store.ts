import { create } from "zustand";
import { invoke } from "../../lib/tauri";
import { loadEnabledRoutes, saveEnabledRoutes } from "../../lib/prefs";
import { toast } from "../../components/ui/toast";
import { withRoutesEnabled } from "./routes";

interface RoutesState {
  enabled: string[];
  setEnabled: (key: string, on: boolean) => void;
  enableAll: (keys: string[]) => void;
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
  return {
    enabled: loadEnabledRoutes(),
    setEnabled: (key, on) => {
      persist(withRoutesEnabled(get().enabled, [key], on));
      push("set_route_enabled", { key, enabled: on });
    },
    enableAll: (keys) => {
      persist(withRoutesEnabled(get().enabled, keys, true));
      push("set_all_routes_enabled", { enabled: true });
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
