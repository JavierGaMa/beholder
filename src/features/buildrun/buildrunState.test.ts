import { describe, expect, it } from "vitest";
import {
  assembleTaskName,
  buildrunWarnings,
  metroPanelState,
  pickDefaultSerial,
  reloadTargets,
} from "./buildrunState";
import type { RnVariantsInfo } from "../../queries/buildrun";

function info(partial: Partial<RnVariantsInfo>): RnVariantsInfo {
  return {
    projectRoot: "/home/dev/rn-app",
    gradleFile: "/home/dev/rn-app/android/app/build.gradle",
    flavors: [],
    buildTypes: ["debug"],
    applicationId: null,
    flavorIds: [],
    duplicateIds: [],
    ...partial,
  };
}

describe("buildrunWarnings", () => {
  it("is empty without detected info", () => {
    expect(buildrunWarnings(null)).toEqual([]);
  });

  it("is empty for a clean detection", () => {
    const clean = info({
      flavors: ["qat", "prod"],
      applicationId: "dev.example.app",
      flavorIds: [
        { flavor: "qat", suffix: ".qat", effective: "dev.example.app.qat" },
        { flavor: "prod", suffix: null, effective: "dev.example.app" },
      ],
    });
    expect(buildrunWarnings(clean)).toEqual([]);
  });

  it("warns in danger when flavors collide on the same id", () => {
    const colliding = info({
      flavors: ["qat", "prod"],
      applicationId: "dev.example.app",
      flavorIds: [
        { flavor: "qat", suffix: null, effective: "dev.example.app" },
        { flavor: "prod", suffix: null, effective: "dev.example.app" },
      ],
      duplicateIds: ["dev.example.app"],
    });
    expect(buildrunWarnings(colliding)).toEqual([
      {
        id: "duplicate-ids",
        kind: "danger",
        text:
          "flavors dev.example.app build the same package id — installing one uninstalls the other",
      },
    ]);
  });

  it("joins several colliding ids with and", () => {
    const colliding = info({
      duplicateIds: ["a.b", "c.d"],
    });
    expect(buildrunWarnings(colliding)[0].text).toContain("a.b and c.d");
  });

  it("warns when a flavor has an unknown effective id", () => {
    const unknown = info({
      flavors: ["qat"],
      flavorIds: [{ flavor: "qat", suffix: ".qat", effective: null }],
    });
    const warnings = buildrunWarnings(unknown);
    expect(warnings.some((w) => w.id === "unknown-app-id" && w.kind === "warn")).toBe(true);
  });
});

describe("reloadTargets", () => {
  it("is empty without detected info", () => {
    expect(reloadTargets(null)).toEqual([]);
  });

  it("exposes the base app when there are no flavors", () => {
    const app = info({ applicationId: "dev.example.app" });
    expect(reloadTargets(app)).toEqual([
      { key: "base", label: "app", pkg: "dev.example.app" },
    ]);
  });

  it("exposes the no-flavor row plus every flavor", () => {
    const flavored = info({
      flavors: ["qat", "prod"],
      applicationId: "dev.example.app",
      flavorIds: [
        { flavor: "qat", suffix: ".qat", effective: "dev.example.app.qat" },
        { flavor: "prod", suffix: null, effective: "dev.example.app" },
      ],
    });
    expect(reloadTargets(flavored)).toEqual([
      { key: "base", label: "(no flavor)", pkg: "dev.example.app" },
      { key: "flavor:qat", label: "qat", pkg: "dev.example.app.qat" },
      { key: "flavor:prod", label: "prod", pkg: "dev.example.app" },
    ]);
  });

  it("keeps flavors with an unknown package id as null", () => {
    const flavored = info({
      flavors: ["qat"],
      flavorIds: [{ flavor: "qat", suffix: ".qat", effective: null }],
    });
    expect(reloadTargets(flavored)).toEqual([
      { key: "flavor:qat", label: "qat", pkg: null },
    ]);
  });
});

describe("pickDefaultSerial", () => {
  it("takes the capture target when it is running", () => {
    expect(pickDefaultSerial("emulator-5554", ["emulator-5556", "emulator-5554"])).toBe(
      "emulator-5554",
    );
  });

  it("falls back to the first running device", () => {
    expect(pickDefaultSerial("emulator-9999", ["emulator-5556"])).toBe("emulator-5556");
    expect(pickDefaultSerial(null, ["emulator-5556"])).toBe("emulator-5556");
  });

  it("is empty with nothing running", () => {
    expect(pickDefaultSerial("emulator-5554", [])).toBe("");
    expect(pickDefaultSerial(null, [])).toBe("");
  });
});

describe("assembleTaskName", () => {
  it("builds the gradle task for a flavored variant", () => {
    expect(assembleTaskName("qat", "debug")).toBe("assembleQatDebug");
  });

  it("builds the gradle task without a flavor", () => {
    expect(assembleTaskName(null, "release")).toBe("assembleRelease");
  });
});

describe("metroPanelState", () => {
  it("reports not running with no status", () => {
    expect(metroPanelState(null, false)).toEqual({
      label: "not running",
      tone: "muted",
    });
  });

  it("reports running with the port", () => {
    expect(metroPanelState({ detected: true, port: 8081 }, false)).toEqual({
      label: "running on :8081",
      tone: "ok",
    });
  });

  it("reports compiling while starting", () => {
    expect(metroPanelState({ detected: false, port: 8081 }, true)).toEqual({
      label: "compiling — first start takes a while",
      tone: "warn",
    });
  });

  it("keeps detected status over the starting phase", () => {
    expect(metroPanelState({ detected: true, port: 8082 }, true)).toEqual({
      label: "running on :8082",
      tone: "ok",
    });
  });
});
