import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDevices } from "./devices";
import { invoke } from "../lib/tauri";
import type { AvdInfo, Device } from "./types";

vi.mock("../lib/tauri", () => ({
  isTauri: false,
  invoke: vi.fn(async () => undefined),
}));

const devices: Device[] = [
  { serial: "emulator-5554", state: "Online", is_emulator: true },
  { serial: "ABC123", state: "Online", is_emulator: false },
];

const avds: AvdInfo[] = [
  {
    name: "Beholder_Dev",
    device: "pixel_7",
    image_tag: "google_apis",
    abi: "arm64-v8a",
    api_level: 32,
    beholder_ready: true,
    running: false,
    serial: null,
  },
];

function mockList(d: Device[], a: AvdInfo[]) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "list_devices") return d as never;
    if (cmd === "list_avds") return a as never;
    return undefined as never;
  });
}

function deferredDevices(payload: Device[] = devices) {
  let release!: (d: Device[]) => void;
  const promise = new Promise<Device[]>((resolve) => {
    release = resolve;
  });
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "list_devices") return promise as never;
    return Promise.resolve(avds) as never;
  });
  return () => release(payload);
}

beforeEach(() => {
  useDevices.setState(useDevices.getInitialState(), true);
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("devices store refresh", () => {
  it("fetches devices and avds on first refresh", async () => {
    mockList(devices, avds);
    await useDevices.getState().refresh();
    const st = useDevices.getState();
    expect(st.status).toBe("ready");
    expect(st.devices).toEqual(devices);
    expect(st.avds).toEqual(avds);
    expect(st.error).toBeNull();
    expect(st.lastFetched).not.toBeNull();
  });

  it("deduplicates concurrent refresh calls into one in-flight fetch", async () => {
    const release = deferredDevices();
    const first = useDevices.getState().refresh();
    const second = useDevices.getState().refresh();
    expect(invoke).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([first, second]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(useDevices.getState().devices).toEqual(devices);
  });

  it("serves cached data within the TTL and refetches once stale", async () => {
    mockList(devices, avds);
    await useDevices.getState().refresh();
    vi.mocked(invoke).mockClear();
    await useDevices.getState().refresh();
    expect(invoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(31_000);
    await useDevices.getState().refresh();
    expect(invoke).toHaveBeenCalledTimes(2);
    const st = useDevices.getState();
    expect(st.status).toBe("ready");
    expect(Date.now() - (st.lastFetched ?? 0)).toBeLessThan(1_000);
  });

  it("keeps cached data visible while a stale refresh is in flight", async () => {
    mockList(devices, avds);
    await useDevices.getState().refresh();
    vi.advanceTimersByTime(31_000);
    const next: Device[] = [{ serial: "emulator-5556", state: "Online", is_emulator: true }];
    const release = deferredDevices(next);
    const pending = useDevices.getState().refresh();
    expect(useDevices.getState().devices).toEqual(devices);
    expect(useDevices.getState().refreshing).toBe(true);
    release();
    await pending;
    const st = useDevices.getState();
    expect(st.devices).toEqual(next);
    expect(st.refreshing).toBe(false);
  });

  it("force bypasses the TTL", async () => {
    mockList(devices, avds);
    await useDevices.getState().refresh();
    vi.mocked(invoke).mockClear();
    await useDevices.getState().refresh(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("surfaces refresh errors while keeping cached data", async () => {
    mockList(devices, avds);
    await useDevices.getState().refresh();
    vi.mocked(invoke).mockRejectedValue(new Error("adb not found"));
    await useDevices.getState().refresh(true);
    const st = useDevices.getState();
    expect(st.error).toBe("adb not found");
    expect(st.status).toBe("ready");
    expect(st.devices).toEqual(devices);
    expect(st.refreshing).toBe(false);
  });

  it("reports an error state when the first load fails and recovers afterwards", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("adb not found"));
    await useDevices.getState().refresh();
    const failed = useDevices.getState();
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("adb not found");
    mockList(devices, avds);
    await useDevices.getState().refresh();
    const st = useDevices.getState();
    expect(st.status).toBe("ready");
    expect(st.error).toBeNull();
    expect(st.devices).toEqual(devices);
  });
});
