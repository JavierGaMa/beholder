import { describe, expect, it } from "vitest";
import type { ApkEntry } from "../../store/types";
import {
  buildTracks,
  capTracks,
  formatRelativeLastModified,
  shouldAutoSwitchMode,
  sortByLastModifiedDesc,
  trackKey,
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

describe("trackKey", () => {
  it("joins env and flavor with a slash", () => {
    expect(trackKey("QA", "release")).toBe("QA/release");
    expect(trackKey("UNKNOWN", "default")).toBe("UNKNOWN/default");
  });
});

describe("buildTracks", () => {
  it("groups entries by env x flavor", () => {
    const tracks = buildTracks([
      entry({ name: "qa-release-1.apk", env: "QA", flavor: "release" }),
      entry({ name: "prod-release-1.apk", env: "PROD", flavor: "release" }),
      entry({ name: "qa-automation-1.apk", env: "QA", flavor: "automation" }),
    ]);
    expect(tracks.map((t) => t.key).sort()).toEqual(["PROD/release", "QA/automation", "QA/release"]);
  });

  it("defaults missing env to UNKNOWN and missing flavor to default", () => {
    const tracks = buildTracks([entry({ name: "a.apk", env: null, flavor: null })]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].env).toBe("UNKNOWN");
    expect(tracks[0].flavor).toBe("default");
    expect(tracks[0].key).toBe("UNKNOWN/default");
  });

  it("normalizes env to uppercase when grouping", () => {
    const tracks = buildTracks([
      entry({ name: "a.apk", env: "qa", flavor: "release" }),
      entry({ name: "b.apk", env: "QA", flavor: "release" }),
    ]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].env).toBe("QA");
    expect(tracks[0].history).toHaveLength(1);
  });

  it("picks the newest entry as latest regardless of input order", () => {
    const tracks = buildTracks([
      entry({ name: "old.apk", last_modified: "Mon, 07 Jul 2026 09:12:44 GMT" }),
      entry({ name: "new.apk", last_modified: "Tue, 08 Jul 2026 10:00:00 GMT" }),
      entry({ name: "mid.apk", last_modified: "Mon, 07 Jul 2026 18:30:00 GMT" }),
    ]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].latest.name).toBe("new.apk");
    expect(tracks[0].history.map((e) => e.name)).toEqual(["mid.apk", "old.apk"]);
  });

  it("sorts tracks by latest recency descending, then key ascending", () => {
    const tracks = buildTracks([
      entry({ name: "qa-old.apk", env: "QA", flavor: "release", last_modified: "Mon, 07 Jul 2026 09:00:00 GMT" }),
      entry({ name: "prod-new.apk", env: "PROD", flavor: "release", last_modified: "Wed, 09 Jul 2026 09:00:00 GMT" }),
      entry({ name: "qa-auto.apk", env: "QA", flavor: "automation", last_modified: "Tue, 08 Jul 2026 09:00:00 GMT" }),
      entry({ name: "beta-new.apk", env: "BETA", flavor: "release", last_modified: "Wed, 09 Jul 2026 09:00:00 GMT" }),
    ]);
    expect(tracks.map((t) => t.key)).toEqual(["BETA/release", "PROD/release", "QA/automation", "QA/release"]);
  });

  it("returns an empty array for no entries", () => {
    expect(buildTracks([])).toEqual([]);
  });
});

describe("capTracks", () => {
  const track = (name: string, historyCount: number) => ({
    key: name,
    env: "QA",
    flavor: name,
    latest: entry({ name: `${name}-latest.apk` }),
    history: Array.from({ length: historyCount }, (_, i) =>
      entry({ name: `${name}-${i}.apk`, last_modified: `Mon, 0${i + 1} Jul 2026 09:00:00 GMT` }),
    ),
  });

  it("keeps everything when under the cap", () => {
    const tracks = [track("a", 1), track("b", 2)];
    expect(capTracks(tracks, 10)).toEqual(tracks);
  });

  it("slices histories first and keeps every latest", () => {
    const capped = capTracks([track("a", 5)], 3);
    expect(capped).toHaveLength(1);
    expect(capped[0].history).toHaveLength(2);
  });

  it("drops whole tracks once the budget is exhausted", () => {
    const capped = capTracks([track("a", 5), track("b", 5)], 4);
    expect(capped).toHaveLength(1);
    expect(capped[0].history).toHaveLength(3);
  });

  it("keeps a bare latest when the budget only fits one entry", () => {
    const capped = capTracks([track("a", 5), track("b", 5)], 2);
    expect(capped.map((t) => t.key)).toEqual(["a"]);
    expect(capped[0].history).toHaveLength(1);
  });

  it("returns nothing for a zero budget", () => {
    expect(capTracks([track("a", 1)], 0)).toEqual([]);
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

describe("shouldAutoSwitchMode", () => {
  it("switches tracks to all when the query is non-empty", () => {
    expect(shouldAutoSwitchMode("tracks", "release")).toBe("all");
  });

  it("keeps all when the query is non-empty", () => {
    expect(shouldAutoSwitchMode("all", "release")).toBe("all");
  });

  it("keeps the current mode when the query is empty", () => {
    expect(shouldAutoSwitchMode("tracks", "")).toBe("tracks");
    expect(shouldAutoSwitchMode("all", "")).toBe("all");
  });

  it("treats a whitespace-only query as empty", () => {
    expect(shouldAutoSwitchMode("tracks", "   ")).toBe("tracks");
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
