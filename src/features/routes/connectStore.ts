import { create } from "zustand";
import { invoke, pickRouteFile } from "../../lib/tauri";
import { loadDiscoveryAddress, saveDiscoveryAddress } from "../../lib/prefs";
import { queryClient } from "../../lib/query";
import { DEFAULT_CONFIG } from "../../lib/theme/config-types";
import { toast } from "../../components/ui/toast";
import { useTraffic } from "../../store/traffic";
import type {
  DiscoverFailure,
  DiscoveryResult,
  RouteConfigFailure,
  RouteFilesUpdate,
} from "../../store/types";
import { useRoutes } from "./store";

interface ConnectRequest {
  path: string;
  replaces: string[];
  label?: string;
}

export type ConnectStep =
  | { kind: "closed" }
  | { kind: "detecting"; address: string }
  | { kind: "found"; discovery: DiscoveryResult; selected: string | null; connecting: boolean }
  | { kind: "address"; found: boolean; address: string; invalid: boolean }
  | {
      kind: "invalid";
      problem: "file" | "response" | "config";
      message: string;
      target: string;
      retry: { action: "detect" } | { action: "choose" } | { action: "connect"; request: ConnectRequest };
      back: ConnectStep;
    };

interface ConnectState {
  step: ConnectStep;
  address: string;
  banner: string | null;
  open: () => void;
  close: () => void;
  setAddress: (address: string) => void;
  detect: () => void;
  select: (id: string) => void;
  connect: () => void;
  chooseFile: () => void;
  retry: () => void;
  back: () => void;
  removeFile: (path: string) => void;
  dismiss: () => void;
}

const CLOSED: ConnectStep = { kind: "closed" };

function failureMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error);
}

function defaultSelection({ files }: DiscoveryResult): string | null {
  const usable = files.filter((file) => file.error === null);
  return (usable.find((file) => file.up > 0) ?? usable[0])?.id ?? null;
}

function applyUpdate(update: RouteFilesUpdate) {
  useRoutes.getState().forget(update.reset);
  const { uiConfig, setUiConfig } = useTraffic.getState();
  setUiConfig({ ...(uiConfig ?? DEFAULT_CONFIG), routes: { files: update.files } });
  void queryClient.invalidateQueries({ queryKey: ["routes"] });
  void queryClient.invalidateQueries({ queryKey: ["routes-health"] });
}

export const useConnect = create<ConnectState>((set, get) => {
  let run = 0;

  function move(step: ConnectStep) {
    run += 1;
    set({ step });
  }

  async function discover(address: string) {
    const previous = get().step;
    move({ kind: "detecting", address });
    const id = run;
    try {
      const discovery = await invoke<DiscoveryResult>("discover_routes", { address });
      if (id !== run) return;
      saveDiscoveryAddress(address);
      set({
        step: { kind: "found", discovery, selected: defaultSelection(discovery), connecting: false },
      });
    } catch (error) {
      if (id !== run) return;
      const kind = (error as Partial<DiscoverFailure> | null)?.kind;
      if (kind === "invalidAddress") {
        const shown = previous.kind === "address" ? previous : { found: false, address };
        set({ step: { ...shown, kind: "address", invalid: true } });
        return;
      }
      saveDiscoveryAddress(address);
      const back: ConnectStep = { kind: "address", found: false, address, invalid: false };
      if (kind !== "invalidResponse") {
        set({ step: back });
        return;
      }
      set({
        step: {
          kind: "invalid",
          problem: "response",
          message: failureMessage(error),
          target: address,
          retry: { action: "detect" },
          back,
        },
      });
    }
  }

  async function link(request: ConnectRequest, back: ConnectStep, id: number) {
    try {
      const update = await invoke<RouteFilesUpdate>("connect_route_file", {
        path: request.path,
        replaces: request.replaces,
      });
      applyUpdate(update);
      if (id !== run) return;
      move(CLOSED);
      const name = request.label ?? update.name;
      set({ banner: `Connected to ${name}. Turn on the services you want to use locally.` });
    } catch (error) {
      if (id !== run) return;
      const invalidFile = (error as Partial<RouteConfigFailure> | null)?.kind === "invalidFile";
      const discovered = request.label !== undefined;
      move({
        kind: "invalid",
        problem: invalidFile ? "file" : "config",
        message: failureMessage(error),
        target: request.path,
        retry:
          invalidFile && !discovered ? { action: "choose" } : { action: "connect", request },
        back,
      });
    }
  }

  async function choose(back: ConnectStep) {
    const id = run;
    try {
      const path = await pickRouteFile();
      if (path === null || id !== run) return;
      await link({ path, replaces: [] }, back, id);
    } catch (error) {
      toast(`Could not choose a file: ${failureMessage(error)}`, "danger");
    }
  }

  return {
    step: CLOSED,
    address: loadDiscoveryAddress(),
    banner: null,
    open: () => {
      const address = loadDiscoveryAddress();
      set({ address, banner: null, step: CLOSED });
      void discover(address);
    },
    close: () => move(CLOSED),
    setAddress: (address) => {
      const { step } = get();
      set({ address, step: step.kind === "address" ? { ...step, invalid: false } : step });
    },
    detect: () => void discover(get().address),
    select: (selected) => {
      const { step } = get();
      if (step.kind !== "found" || step.connecting) return;
      if (!step.discovery.files.some((f) => f.id === selected && f.error === null)) return;
      set({ step: { ...step, selected } });
    },
    connect: () => {
      const { step } = get();
      if (step.kind !== "found" || step.connecting) return;
      const file = step.discovery.files.find((f) => f.id === step.selected);
      if (!file) return;
      set({ step: { ...step, connecting: true } });
      const request = {
        path: file.path,
        replaces: step.discovery.files.map((f) => f.path).filter((path) => path !== file.path),
        label: `${step.discovery.name} ${file.label}`,
      };
      void link(request, step, run);
    },
    chooseFile: () => {
      const { step } = get();
      void choose(step.kind === "invalid" ? step.back : step);
    },
    retry: () => {
      const { step } = get();
      if (step.kind !== "invalid") return;
      if (step.retry.action === "detect") {
        void discover(step.target);
      } else if (step.retry.action === "choose") {
        void choose(step.back);
      } else if (step.back.kind === "found") {
        move({ ...step.back, connecting: true });
        void link(step.retry.request, step.back, run);
      } else {
        move({ ...step });
        void link(step.retry.request, step.back, run);
      }
    },
    back: () => {
      const { step } = get();
      if (step.kind === "invalid") {
        move(step.back);
      } else if (step.kind === "found") {
        const { address } = step.discovery;
        set({ address });
        move({ kind: "address", found: true, address, invalid: false });
      }
    },
    removeFile: (path) => {
      set({ banner: null });
      invoke<RouteFilesUpdate>("remove_route_file", { path })
        .then(applyUpdate)
        .catch((e) => toast(`Could not remove the route file: ${failureMessage(e)}`, "danger"));
    },
    dismiss: () => set({ banner: null }),
  };
});
