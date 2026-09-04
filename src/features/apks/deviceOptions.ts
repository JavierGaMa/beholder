import type { AvdInfo, Device } from "../../store/types";

export interface RunningDeviceOption {
  kind: "device";
  id: string;
  serial: string;
  isEmulator: boolean;
}

export interface StoppedAvdOption {
  kind: "avd";
  id: string;
  name: string;
  apiLevel: number | null;
  beholderReady: boolean;
}

export type DeviceOption = RunningDeviceOption | StoppedAvdOption;

export type BootState =
  | { phase: "idle" }
  | { phase: "booting"; avdName: string }
  | { phase: "error"; avdName: string; message: string };

export type BootEvent =
  | { type: "start"; avdName: string }
  | { type: "fail"; avdName: string; message: string }
  | { type: "reset" };

export function onlineDevices(devices: Device[] | null | undefined): Device[] {
  return (devices ?? []).filter((d) => d.state === "Online");
}

export function buildDeviceOptions(
  devices: Device[] | null | undefined,
  avds: AvdInfo[] | null | undefined,
): DeviceOption[] {
  const running: DeviceOption[] = onlineDevices(devices).map((d) => ({
    kind: "device",
    id: d.serial,
    serial: d.serial,
    isEmulator: d.is_emulator,
  }));
  const seen = new Set(running.map((o) => o.id));
  for (const a of avds ?? []) {
    if (a.running && a.serial && !seen.has(a.serial)) {
      running.push({ kind: "device", id: a.serial, serial: a.serial, isEmulator: true });
      seen.add(a.serial);
    }
  }
  const stopped: DeviceOption[] = (avds ?? [])
    .filter((a) => !a.running)
    .map((a) => ({
      kind: "avd",
      id: `avd:${a.name}`,
      name: a.name,
      apiLevel: a.api_level,
      beholderReady: a.beholder_ready,
    }));
  return [...running, ...stopped];
}

export function applyBootEvent(state: BootState, event: BootEvent): BootState {
  switch (event.type) {
    case "start":
      return { phase: "booting", avdName: event.avdName };
    case "fail":
      if (state.phase !== "booting" || state.avdName !== event.avdName) return state;
      return { phase: "error", avdName: event.avdName, message: event.message };
    case "reset":
      return { phase: "idle" };
  }
}
