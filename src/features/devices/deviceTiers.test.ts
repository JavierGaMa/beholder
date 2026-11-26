import { describe, expect, it } from "vitest";
import type { Device, DeviceReport, TierState } from "../../store/types";
import { wizardModel } from "./deviceTiers";

const phone = (state: Device["state"]): Device => ({
  serial: "R5CT91",
  state,
  is_emulator: false,
  model: "SM S911B",
});

const report = (full: TierState, userCa: TierState, root: DeviceReport["probe"]["root"]): DeviceReport => ({
  probe: {
    serial: "R5CT91",
    model: "SM-S911B",
    android_release: "14",
    sdk: 34,
    is_emulator: false,
    root,
    system_ca_installed: full === "ready",
    companion_version: null,
    user_ca_installed: null,
  },
  companion_desktop: false,
  tiers: [
    { tier: "basic", state: "ready", detail: "basic detail" },
    { tier: "user_ca", state: userCa, detail: "user detail" },
    { tier: "full", state: full, detail: "full detail" },
  ],
});

const actions = (model: ReturnType<typeof wizardModel>) => model.cards.map((c) => c.action);

describe("wizardModel", () => {
  it("offers steps and root information on a stock phone", () => {
    const model = wizardModel("R5CT91", phone("Online"), report("locked", "action", "none"));
    expect(model.title).toBe("SM-S911B");
    expect(model.meta).toBe("Android 14 · R5CT91");
    expect(model.state).toEqual({ label: "Connected", tone: "ok" });
    expect(model.banner).toBeNull();
    expect(actions(model)).toEqual([null, "steps", "why"]);
    expect(model.canCapture).toBe(true);
  });

  it("offers the unlock when root is available", () => {
    const model = wizardModel("R5CT91", phone("Online"), report("action", "action", "su"));
    expect(actions(model)).toEqual([null, "steps", "unlock"]);
  });

  it("offers a retry of the unlock when su was denied", () => {
    const model = wizardModel("R5CT91", phone("Online"), report("action", "action", "su_denied"));
    expect(actions(model)[2]).toBe("unlock");
  });

  it("offers nothing once everything is ready", () => {
    const model = wizardModel("R5CT91", phone("Online"), report("ready", "ready", "su"));
    expect(actions(model)).toEqual([null, null, null]);
  });

  it("explains an unauthorized phone and locks every tier", () => {
    const model = wizardModel("R5CT91", phone("Unauthorized"), null);
    expect(model.state).toEqual({ label: "Unauthorized", tone: "warn" });
    expect(model.banner).toContain("USB debugging prompt");
    expect(model.cards.every((c) => c.state === "locked" && c.action === null)).toBe(true);
    expect(model.canCapture).toBe(false);
  });

  it("reports a phone that is no longer visible", () => {
    const model = wizardModel("R5CT91", null, null);
    expect(model.state.label).toBe("Disconnected");
    expect(model.title).toBe("R5CT91");
    expect(model.canCapture).toBe(false);
  });

  it("describes the companion from the probe", () => {
    const base = report("locked", "action", "none");
    expect(wizardModel("R5CT91", phone("Online"), base).companion).toBe("missing");
    const old = { ...base, probe: { ...base.probe, companion_version: "0.2.0" } };
    expect(wizardModel("R5CT91", phone("Online"), old).companion).toBe("outdated");
    const ready = {
      ...base,
      probe: { ...base.probe, companion_version: "0.3.0" },
      companion_desktop: true,
    };
    expect(wizardModel("R5CT91", phone("Online"), ready).companion).toBe("ready");
    expect(wizardModel("R5CT91", phone("Offline"), ready).companion).toBeNull();
  });

  it("waits for the probe without locking capture", () => {
    const model = wizardModel("R5CT91", phone("Online"), null);
    expect(model.canCapture).toBe(true);
    expect(model.cards[1]?.detail).toBe("Checking the phone…");
  });
});
