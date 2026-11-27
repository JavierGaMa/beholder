import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { command: string; args: Record<string, unknown> }[] = [];
vi.mock("../../lib/tauri", () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    calls.push({ command, args });
    return Promise.resolve(4321);
  },
}));

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

const { startCapture } = await import("./startCapture");
const { useTraffic } = await import("../../store/traffic");

beforeEach(() => {
  calls.length = 0;
  useTraffic.setState({ targetSerial: null, targetKind: null, targetPackage: null });
});

describe("startCapture", () => {
  it("sends the chosen app for the phone target", async () => {
    useTraffic.getState().setTarget("R5CT91", "S23", "device");
    useTraffic.getState().setTargetPackage("com.x.app");
    await startCapture("R5CT91");
    expect(calls[0]?.args.package).toBe("com.x.app");
    expect(useTraffic.getState().capturePort).toBe(4321);
  });

  it("sends no app for another serial", async () => {
    useTraffic.getState().setTarget("R5CT91", "S23", "device");
    useTraffic.getState().setTargetPackage("com.x.app");
    await startCapture("OTHER", "capture_restart");
    expect(calls[0]?.command).toBe("capture_restart");
    expect(calls[0]?.args.package).toBeNull();
  });

  it("forgets the chosen app when the target changes", () => {
    useTraffic.getState().setTarget("R5CT91", "S23", "device");
    useTraffic.getState().setTargetPackage("com.x.app");
    useTraffic.getState().setTarget("R5CT91", "S23", "device");
    expect(useTraffic.getState().targetPackage).toBe("com.x.app");
    useTraffic.getState().setTarget("emulator-5554", "A", "emulator");
    expect(useTraffic.getState().targetPackage).toBeNull();
  });
});
