import { describe, expect, it } from "vitest";
import type { AvdInfo, Device } from "../../store/types";
import { buildTargetItems, type TargetItemsInput } from "./targetItems";

const avd = (name: string, running: boolean): AvdInfo => ({
  name,
  device: null,
  image_tag: "google_apis",
  abi: "arm64-v8a",
  api_level: 35,
  beholder_ready: true,
  running,
  serial: running ? "emulator-5554" : null,
});

const phone = (patch: Partial<Device> = {}): Device => ({
  serial: "R5CT91",
  state: "Online",
  is_emulator: false,
  model: "SM S911B",
  ...patch,
});

function build(patch: Partial<TargetItemsInput> = {}) {
  const picked: string[] = [];
  const items = buildTargetItems({
    avds: [],
    devices: [],
    targetSerial: null,
    targetAvd: null,
    adbError: null,
    onSelectAvd: (a) => picked.push(`avd:${a.name}`),
    onSelectDevice: (d) => picked.push(`device:${d.serial}`),
    onCreate: () => picked.push("create"),
    ...patch,
  });
  return { items, picked };
}

const labels = (patch: Partial<TargetItemsInput>) => build(patch).items.map((i) => i.label);

describe("buildTargetItems", () => {
  it("lists running and stopped emulators under their headers", () => {
    expect(labels({ avds: [avd("A", true), avd("B", false)] })).toEqual([
      "running",
      "A · API 35",
      "stopped",
      "B · API 35",
      "Create emulator",
    ]);
  });

  it("lists physical devices and ignores emulator serials from adb", () => {
    const out = labels({
      devices: [phone(), { serial: "emulator-5554", state: "Online", is_emulator: true, model: null }],
    });
    expect(out).toEqual(["devices", "SM S911B · device", "Create emulator"]);
  });

  it("falls back to the serial when the model is unknown", () => {
    expect(labels({ devices: [phone({ model: null })] })).toContain("R5CT91 · device");
  });

  it("selects an online device", () => {
    const { items, picked } = build({ devices: [phone()] });
    items.find((i) => i.key === "device-R5CT91")?.onSelect();
    expect(picked).toEqual(["device:R5CT91"]);
  });

  it("marks the active device", () => {
    expect(labels({ devices: [phone()], targetSerial: "R5CT91" })).toContain(
      "SM S911B · device · active",
    );
  });

  it("disables an unauthorized device with the reason", () => {
    const item = build({ devices: [phone({ state: "Unauthorized", model: null })] }).items[1];
    expect(item?.disabled).toBe(true);
    expect(item?.label).toBe("R5CT91 · accept the USB debugging prompt on the phone");
  });

  it("disables an offline device with the reason", () => {
    const item = build({ devices: [phone({ state: "Offline" })] }).items[1];
    expect(item?.disabled).toBe(true);
    expect(item?.label).toBe("SM S911B · offline, reconnect the cable");
  });

  it("shows the empty row only without emulators and devices", () => {
    expect(labels({})).toEqual(["No emulators found — create one below.", "Create emulator"]);
    expect(labels({ devices: [phone()] })).not.toContain("No emulators found — create one below.");
  });

  it("shows the adb error instead of targets", () => {
    expect(labels({ adbError: "adb not found", devices: [phone()] })).toEqual([
      "adb not found",
      "Create emulator",
    ]);
  });
});
