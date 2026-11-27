import { describe, expect, it } from "vitest";
import type { Device } from "../../store/types";
import { shouldOpenSetup } from "./shouldOpenSetup";

const phone = (state: Device["state"]): Device => ({
  serial: "R5CT91",
  state,
  is_emulator: false,
  model: null,
});
const emulatorFail = [{ id: "emulator", status: "fail" }];

describe("shouldOpenSetup", () => {
  it("stays closed when nothing fails", () => {
    expect(shouldOpenSetup([{ id: "java", status: "ok" }], [])).toBe(false);
  });

  it("opens when the emulator toolchain fails and there is no phone", () => {
    expect(shouldOpenSetup(emulatorFail, [])).toBe(true);
  });

  it("stays closed for emulator failures when a phone is online", () => {
    expect(shouldOpenSetup(emulatorFail, [phone("Online")])).toBe(false);
  });

  it("ignores phones that are not online and emulator devices", () => {
    expect(shouldOpenSetup(emulatorFail, [phone("Unauthorized")])).toBe(true);
    expect(
      shouldOpenSetup(emulatorFail, [{ ...phone("Online"), serial: "emulator-5554", is_emulator: true }]),
    ).toBe(true);
  });

  it("always opens when adb is missing", () => {
    expect(shouldOpenSetup([{ id: "platform_tools", status: "fail" }], [phone("Online")])).toBe(true);
  });
});
