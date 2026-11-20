import { describe, expect, it } from "vitest";
import type { AvdInfo } from "../../store/types";
import { avdSummary, doctorSummary, resolveSelectedAvd } from "./emulatorSelection";

function avd(partial: Partial<AvdInfo>): AvdInfo {
  return {
    name: "Pixel_8",
    device: "pixel_8",
    image_tag: "google_apis",
    abi: "arm64-v8a",
    api_level: 35,
    beholder_ready: true,
    running: false,
    serial: null,
    ...partial,
  };
}

describe("resolveSelectedAvd", () => {
  const avds = [
    avd({ name: "A" }),
    avd({ name: "B", running: true, serial: "emulator-5556" }),
    avd({ name: "C", running: true, serial: "emulator-5554" }),
  ];

  it("returns null when there are no emulators", () => {
    expect(resolveSelectedAvd([], null, null, null)).toBeNull();
  });

  it("keeps an explicit selection that still exists", () => {
    expect(resolveSelectedAvd(avds, "A", "emulator-5554", "C")?.name).toBe("A");
  });

  it("defaults to the running capture target by serial", () => {
    expect(resolveSelectedAvd(avds, null, "emulator-5554", null)?.name).toBe("C");
  });

  it("defaults to the running capture target by avd name", () => {
    expect(resolveSelectedAvd(avds, null, null, "B")?.name).toBe("B");
  });

  it("ignores a target that is not running and falls back to the first", () => {
    expect(resolveSelectedAvd(avds, null, null, "A")?.name).toBe("A");
    expect(resolveSelectedAvd([avd({ name: "X" }), avd({ name: "Y" })], null, null, "Y")?.name).toBe(
      "X",
    );
  });

  it("falls back to the default when the explicit selection disappeared", () => {
    expect(resolveSelectedAvd(avds, "Gone", "emulator-5556", null)?.name).toBe("B");
  });
});

describe("avdSummary", () => {
  it("joins device, API level and tag", () => {
    expect(avdSummary(avd({}))).toBe("pixel_8, API 35, google_apis");
  });

  it("uses a question mark for unknown fields", () => {
    expect(avdSummary(avd({ device: null, api_level: null, image_tag: null }))).toBe("?, API ?, ?");
  });
});

describe("doctorSummary", () => {
  it("counts passing checks and the issues fix-all addresses", () => {
    const summary = doctorSummary([
      { status: "ok", fix: null },
      { status: "warn", fix: "sync_clock" },
      { status: "fail", fix: "install_ca" },
      { status: "fail", fix: "reboot" },
      { status: "warn", fix: null },
    ]);
    expect(summary).toEqual({ passing: 1, total: 5, fixCount: 2 });
  });

  it("reports zero issues when every check passes", () => {
    expect(doctorSummary([{ status: "ok", fix: null }])).toEqual({
      passing: 1,
      total: 1,
      fixCount: 0,
    });
  });
});
