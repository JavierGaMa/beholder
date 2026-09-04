import { describe, expect, it } from "vitest";
import { downloadPct, filterApks, formatBytes, type ApkEntry } from "./apksFormat";

function entry(partial: Partial<ApkEntry>): ApkEntry {
  return {
    name: "advisor-v0.0.4-QA-build-4-release-RN-from-07-07-2026.apk",
    url: "https://example.dev/a.apk",
    version: "0.0.4",
    env: "QA",
    build: 4,
    flavor: "release",
    date: "07-07-2026",
    size_bytes: 85689296,
    last_modified: "Mon, 07 Jul 2026 09:12:44 GMT",
    ...partial,
  };
}

describe("formatBytes", () => {
  it("returns 0 B for zero and invalid values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });

  it("formats bytes without decimals", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats KB and MB with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(85689296)).toBe("81.7 MB");
  });

  it("rounds large values and uses GB", () => {
    expect(formatBytes(220145971)).toBe("210 MB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });
});

describe("filterApks", () => {
  const list = [
    entry({ name: "advisor-v0.0.4-QA-build-4-release.apk", env: "QA" }),
    entry({ name: "advisor-v0.0.5-PROD-build-5-release.apk", env: "PROD" }),
    entry({ name: "advisor-v2.0.12-QA-build-2012-automation.apk", env: "QA", version: "2.0.12" }),
  ];

  it("filters by env", () => {
    expect(filterApks(list, "", "QA")).toHaveLength(2);
    expect(filterApks(list, "", "PROD")).toHaveLength(1);
    expect(filterApks(list, "", "all")).toHaveLength(3);
  });

  it("filters by query on name", () => {
    expect(filterApks(list, "2.0.12", "all")).toHaveLength(1);
    expect(filterApks(list, "PROD", "all")).toHaveLength(1);
    expect(filterApks(list, "nope", "all")).toHaveLength(0);
  });

  it("combines query and env", () => {
    expect(filterApks(list, "advisor", "QA")).toHaveLength(2);
    expect(filterApks(list, "2.0.12", "PROD")).toHaveLength(0);
  });

  it("keeps entries without env when filter is all", () => {
    const withNull = [...list, entry({ env: null })];
    expect(filterApks(withNull, "", "all")).toHaveLength(4);
    expect(filterApks(withNull, "", "QA")).toHaveLength(2);
  });
});

describe("downloadPct", () => {
  it("returns 0 when total is unknown", () => {
    expect(downloadPct(100, 0)).toBe(0);
  });

  it("computes rounded percentage", () => {
    expect(downloadPct(1, 3)).toBe(33);
    expect(downloadPct(50, 100)).toBe(50);
  });

  it("caps at 100", () => {
    expect(downloadPct(120, 100)).toBe(100);
  });
});
