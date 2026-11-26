import { Check, CircleDot, Plus, Settings2 } from "lucide-react";
import type { MenuOption } from "../../components/ui/Menu";
import type { AvdInfo, Device } from "../../store/types";

export interface TargetItemsInput {
  avds: AvdInfo[];
  devices: Device[];
  targetSerial: string | null;
  targetAvd: string | null;
  adbError: string | null;
  onSelectAvd: (avd: AvdInfo) => void;
  onSelectDevice: (device: Device) => void;
  onCreate: () => void;
  onSetup: (serial: string) => void;
}

function header(key: string, label: string): MenuOption {
  return { key, label, disabled: true, onSelect: () => {} };
}

function avdItem(avd: AvdInfo, input: TargetItemsInput): MenuOption {
  const active = input.targetAvd === avd.name;
  const meta = avd.running || avd.beholder_ready ? `API ${avd.api_level ?? "?"}` : "no root";
  return {
    key: `${avd.running ? "run" : "stop"}-${avd.name}`,
    label: `${avd.name} · ${meta}${active ? " · active" : ""}`,
    icon: active ? Check : avd.running ? CircleDot : undefined,
    onSelect: () => input.onSelectAvd(avd),
  };
}

function unavailableReason(device: Device): string | null {
  if (device.state === "Unauthorized") return "accept the USB debugging prompt on the phone";
  if (device.state === "Offline") return "offline, reconnect the cable";
  if (device.state === "Unknown") return "state unknown, reconnect the cable";
  return null;
}

function deviceItem(device: Device, input: TargetItemsInput): MenuOption {
  const name = device.model ?? device.serial;
  const reason = unavailableReason(device);
  const active = input.targetSerial === device.serial;
  return {
    key: `device-${device.serial}`,
    label: reason ? `${name} · ${reason}` : `${name} · device${active ? " · active" : ""}`,
    icon: active ? Check : reason ? undefined : CircleDot,
    disabled: reason != null,
    onSelect: () => input.onSelectDevice(device),
  };
}

export function buildTargetItems(input: TargetItemsInput): MenuOption[] {
  const items: MenuOption[] = [];
  const phones = input.devices.filter((d) => !d.is_emulator);
  if (input.adbError) {
    items.push({ ...header("adb-error", input.adbError), danger: true });
  } else if (input.avds.length === 0 && phones.length === 0) {
    items.push(header("no-avds", "No emulators found — create one below."));
  } else {
    const running = input.avds.filter((a) => a.running);
    const stopped = input.avds.filter((a) => !a.running);
    if (running.length > 0) items.push(header("hdr-running", "running"));
    running.forEach((a) => items.push(avdItem(a, input)));
    if (stopped.length > 0) items.push(header("hdr-stopped", "stopped"));
    stopped.forEach((a) => items.push(avdItem(a, input)));
    if (phones.length > 0) items.push(header("hdr-devices", "devices"));
    phones.forEach((d) => items.push(deviceItem(d, input)));
  }
  const target = phones.find((d) => d.serial === input.targetSerial);
  if (target) {
    items.push({
      key: "device-setup",
      label: "Device setup",
      icon: Settings2,
      onSelect: () => input.onSetup(target.serial),
    });
  }
  items.push({ key: "create-emulator", label: "Create emulator", icon: Plus, onSelect: input.onCreate });
  return items;
}
