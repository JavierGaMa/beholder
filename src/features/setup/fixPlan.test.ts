import { describe, expect, it } from "vitest";
import { fixPlan, type HostCheckT } from "./fixPlan";

function check(fix: string | null, status: HostCheckT["status"] = "fail"): HostCheckT {
  return { id: fix ?? "x", title: "t", status, detail: "d", fix };
}

describe("fixPlan", () => {
  it("orders fixes by dependency order regardless of check order", () => {
    const plan = fixPlan([
      check("install_sdk_packages"),
      check("install_android_studio"),
      check("install_cmdline_tools"),
    ]);
    expect(plan).toEqual([
      "install_android_studio",
      "install_cmdline_tools",
      "install_sdk_packages",
    ]);
  });

  it("skips fixes whose check already passes", () => {
    expect(fixPlan([check("install_android_studio"), check(null, "ok")])).toEqual([
      "install_android_studio",
    ]);
  });

  it("ignores soft warnings without fixes", () => {
    expect(fixPlan([check(null, "warn")])).toEqual([]);
  });
});
