import { describe, expect, it } from "vitest";
import type { AvdInfo, Device } from "../../store/types";
import { applyBootEvent, buildDeviceOptions, onlineDevices } from "./deviceOptions";

function device(partial: Partial<Device>): Device {
  return { serial: "emulator-5554", state: "Online", is_emulator: true, ...partial };
}

function avd(partial: Partial<AvdInfo>): AvdInfo {
  return {
    name: "Beholder_Dev",
    device: "pixel_7",
    image_tag: "google_apis",
    abi: "arm64-v8a",
    api_level: 32,
    beholder_ready: true,
    running: false,
    serial: null,
    ...partial,
  };
}

describe("onlineDevices", () => {
  it("keeps only Online devices", () => {
    const list = [
      device({ serial: "a", state: "Online" }),
      device({ serial: "b", state: "Offline" }),
      device({ serial: "c", state: "Unauthorized" }),
      device({ serial: "d", state: "Unknown" }),
    ];
    expect(onlineDevices(list).map((d) => d.serial)).toEqual(["a"]);
  });

  it("tolerates missing input", () => {
    expect(onlineDevices(null)).toEqual([]);
    expect(onlineDevices(undefined)).toEqual([]);
  });
});

describe("buildDeviceOptions", () => {
  it("lists online emulators and physical devices as running options", () => {
    const options = buildDeviceOptions(
      [
        device({ serial: "emulator-5554", is_emulator: true }),
        device({ serial: "ABC123", is_emulator: false }),
      ],
      [],
    );
    expect(options).toEqual([
      { kind: "device", id: "emulator-5554", serial: "emulator-5554", isEmulator: true },
      { kind: "device", id: "ABC123", serial: "ABC123", isEmulator: false },
    ]);
  });

  it("excludes offline and unauthorized devices", () => {
    const options = buildDeviceOptions(
      [
        device({ serial: "a", state: "Offline" }),
        device({ serial: "b", state: "Unauthorized" }),
      ],
      [],
    );
    expect(options).toEqual([]);
  });

  it("does not duplicate a running AVD whose serial is already listed", () => {
    const options = buildDeviceOptions(
      [device({ serial: "emulator-5554" })],
      [avd({ name: "Pixel_9", running: true, serial: "emulator-5554" }), avd({ name: "Stopped_One" })],
    );
    const running = options.filter((o) => o.kind === "device");
    expect(running).toHaveLength(1);
    expect(options.filter((o) => o.kind === "avd")).toHaveLength(1);
  });

  it("keeps a running AVD serial missing from the device list", () => {
    const options = buildDeviceOptions(undefined, [
      avd({ name: "Pixel_9", running: true, serial: "emulator-5556" }),
    ]);
    expect(options).toEqual([
      { kind: "device", id: "emulator-5556", serial: "emulator-5556", isEmulator: true },
    ]);
  });

  it("maps stopped AVDs to bootable options", () => {
    const options = buildDeviceOptions([], [
      avd({ name: "Beholder_Dev", api_level: 32, beholder_ready: true }),
      avd({ name: "No_Root", api_level: 34, beholder_ready: false, running: false }),
    ]);
    expect(options).toEqual([
      { kind: "avd", id: "avd:Beholder_Dev", name: "Beholder_Dev", apiLevel: 32, beholderReady: true },
      { kind: "avd", id: "avd:No_Root", name: "No_Root", apiLevel: 34, beholderReady: false },
    ]);
  });

  it("tolerates missing inputs", () => {
    expect(buildDeviceOptions(null, undefined)).toEqual([]);
  });
});

describe("applyBootEvent", () => {
  it("starts booting for the selected AVD", () => {
    expect(applyBootEvent({ phase: "idle" }, { type: "start", avdName: "A" })).toEqual({
      phase: "booting",
      avdName: "A",
    });
  });

  it("records a failure with the raw message while that AVD boots", () => {
    const booting = { phase: "booting" as const, avdName: "A" };
    expect(
      applyBootEvent(booting, { type: "fail", avdName: "A", message: "adb exploded" }),
    ).toEqual({ phase: "error", avdName: "A", message: "adb exploded" });
  });

  it("ignores stale failures from a different AVD", () => {
    const booting = { phase: "booting" as const, avdName: "B" };
    expect(
      applyBootEvent(booting, { type: "fail", avdName: "A", message: "late failure" }),
    ).toBe(booting);
  });

  it("ignores failures when no boot is in progress", () => {
    expect(
      applyBootEvent({ phase: "idle" }, { type: "fail", avdName: "A", message: "late failure" }),
    ).toEqual({ phase: "idle" });
  });

  it("resets to idle", () => {
    const booting = { phase: "booting" as const, avdName: "A" };
    expect(applyBootEvent(booting, { type: "reset" })).toEqual({ phase: "idle" });
  });
});
