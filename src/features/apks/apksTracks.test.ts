import { describe, expect, it } from "vitest";
import type { ApkEntry } from "../../store/types";
import {
  formatRelativeLastModified,
  normalizedEnv,
  normalizedFlavor,
  sortByLastModifiedDesc,
} from "./apksTracks";

function entry(partial: Partial<ApkEntry>): ApkEntry {
  return {
    name: "advisor-v0.0.4-QA-build-4-release.apk",
    url: "https://example.dev/a.apk",
    version: "0.0.4",
    env: "QA",
    build: 4,
    flavor: "release",
    date: "07-07-2026",
    size_bytes: 1024,
    last_modified: "Mon, 07 Jul 2026 09:12:44 GMT",
    ...partial,
  };
}

describe("normalizedEnv", () => {
  it("uppercases the env", () => {
    expect(normalizedEnv("qa")).toBe("QA");
    expect(normalizedEnv("PROD")).toBe("PROD");
  });

  it("defaults missing env to UNKNOWN", () => {
    expect(normalizedEnv(null)).toBe("UNKNOWN");
    expect(normalizedEnv(undefined)).toBe("UNKNOWN");
    expect(normalizedEnv("")).toBe("UNKNOWN");
  });
});

describe("normalizedFlavor", () => {
  it("trims the flavor", () => {
    expect(normalizedFlavor("  release ")).toBe("release");
  });

  it("defaults missing flavor to default", () => {
    expect(normalizedFlavor(null)).toBe("default");
    expect(normalizedFlavor(undefined)).toBe("default");
    expect(normalizedFlavor("   ")).toBe("default");
  });
});

describe("sortByLastModifiedDesc", () => {
  it("sorts entries newest first", () => {
    const sorted = sortByLastModifiedDesc([
      entry({ name: "old.apk", last_modified: "Mon, 07 Jul 2026 09:00:00 GMT" }),
      entry({ name: "new.apk", last_modified: "Wed, 09 Jul 2026 09:00:00 GMT" }),
      entry({ name: "mid.apk", last_modified: "Tue, 08 Jul 2026 09:00:00 GMT" }),
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["new.apk", "mid.apk", "old.apk"]);
  });

  it("places invalid dates last, preserving input order", () => {
    const sorted = sortByLastModifiedDesc([
      entry({ name: "bad-1.apk", last_modified: "not-a-date" }),
      entry({ name: "good.apk", last_modified: "Tue, 08 Jul 2026 09:00:00 GMT" }),
      entry({ name: "bad-2.apk", last_modified: "" }),
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["good.apk", "bad-1.apk", "bad-2.apk"]);
  });

  it("keeps input order for equal timestamps", () => {
    const at = "Tue, 08 Jul 2026 09:00:00 GMT";
    const sorted = sortByLastModifiedDesc([
      entry({ name: "b.apk", last_modified: at }),
      entry({ name: "a.apk", last_modified: at }),
      entry({ name: "c.apk", last_modified: at }),
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["b.apk", "a.apk", "c.apk"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      entry({ name: "old.apk", last_modified: "Mon, 07 Jul 2026 09:00:00 GMT" }),
      entry({ name: "new.apk", last_modified: "Wed, 09 Jul 2026 09:00:00 GMT" }),
    ];
    sortByLastModifiedDesc(input);
    expect(input.map((e) => e.name)).toEqual(["old.apk", "new.apk"]);
  });

  it("returns an empty array for no entries", () => {
    expect(sortByLastModifiedDesc([])).toEqual([]);
  });
});

describe("formatRelativeLastModified", () => {
  const NOW = Date.parse("Tue, 07 Jul 2026 12:00:00 GMT");

  it("says just now under a minute", () => {
    expect(formatRelativeLastModified("Tue, 07 Jul 2026 11:59:45 GMT", NOW)).toBe("just now");
    expect(formatRelativeLastModified("Tue, 07 Jul 2026 12:00:00 GMT", NOW)).toBe("just now");
  });

  it("formats minutes, hours, and days", () => {
    expect(formatRelativeLastModified("Tue, 07 Jul 2026 11:54:30 GMT", NOW)).toBe("5m ago");
    expect(formatRelativeLastModified("Tue, 07 Jul 2026 08:40:00 GMT", NOW)).toBe("3h ago");
    expect(formatRelativeLastModified("Sun, 05 Jul 2026 12:00:00 GMT", NOW)).toBe("2d ago");
  });

  it("uses minute boundaries at exactly 60s and 59s", () => {
    expect(formatRelativeLastModified("Tue, 07 Jul 2026 11:59:00 GMT", NOW)).toBe("1m ago");
    expect(formatRelativeLastModified("Tue, 07 Jul 2026 11:59:01 GMT", NOW)).toBe("just now");
  });

  it("switches units at exact hour and day boundaries", () => {
    expect(formatRelativeLastModified("Tue, 07 Jul 2026 11:00:00 GMT", NOW)).toBe("1h ago");
    expect(formatRelativeLastModified("Mon, 06 Jul 2026 12:00:00 GMT", NOW)).toBe("1d ago");
  });

  it("falls back to the ISO date beyond seven days", () => {
    expect(formatRelativeLastModified("Tue, 30 Jun 2026 12:00:01 GMT", NOW)).toBe("6d ago");
    expect(formatRelativeLastModified("Tue, 30 Jun 2026 12:00:00 GMT", NOW)).toBe("2026-06-30");
    expect(formatRelativeLastModified("Sun, 28 Jun 2026 12:00:00 GMT", NOW)).toBe("2026-06-28");
  });

  it("treats future timestamps as just now", () => {
    expect(formatRelativeLastModified("Tue, 07 Jul 2026 12:00:10 GMT", NOW)).toBe("just now");
  });

  it("returns an empty string for unparseable dates", () => {
    expect(formatRelativeLastModified("not-a-date", NOW)).toBe("");
    expect(formatRelativeLastModified("", NOW)).toBe("");
  });
});
