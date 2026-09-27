import { describe, expect, it } from "vitest";
import type { ApkEntry } from "../../store/types";
import {
  applyDownloadProgress,
  effectiveDirLabel,
  localFileName,
  matchLocalFiles,
  type DownloadPhase,
  type LocalApk,
} from "./apksLocalState";

describe("localFileName", () => {
  it("strips the blob prefix down to the file name", () => {
    expect(localFileName("APKs/foo.apk")).toBe("foo.apk");
  });

  it("keeps unprefixed names unchanged", () => {
    expect(localFileName("foo.apk")).toBe("foo.apk");
  });

  it("drops trailing slashes before taking the last token", () => {
    expect(localFileName("APKs/foo.apk/")).toBe("foo.apk");
  });

  it("keeps the directory token when only the prefix remains", () => {
    expect(localFileName("APKs/")).toBe("APKs");
  });

  it("maps degenerate names to the empty string", () => {
    expect(localFileName("")).toBe("");
    expect(localFileName("/")).toBe("");
    expect(localFileName(".")).toBe("");
    expect(localFileName("..")).toBe("");
  });
});

describe("applyDownloadProgress", () => {
  it("updates a downloading row keyed by the payload name", () => {
    const rows: Record<string, DownloadPhase> = {
      "foo.apk": { phase: "downloading", received: 0, total: 100 },
    };
    expect(
      applyDownloadProgress(rows, { name: "foo.apk", received: 40, total: 100 }),
    ).toEqual({
      "foo.apk": { phase: "downloading", received: 40, total: 100 },
    });
  });

  it("leaves idle, installing, done, and error rows untouched", () => {
    const rows: Record<string, DownloadPhase> = {
      "foo.apk": { phase: "idle" },
      "bar.apk": { phase: "installing" },
      "baz.apk": { phase: "done" },
      "qux.apk": { phase: "error", message: "boom" },
    };
    expect(applyDownloadProgress(rows, { name: "foo.apk", received: 1, total: 2 })).toBe(rows);
    expect(applyDownloadProgress(rows, { name: "bar.apk", received: 1, total: 2 })).toBe(rows);
    expect(applyDownloadProgress(rows, { name: "baz.apk", received: 1, total: 2 })).toBe(rows);
    expect(applyDownloadProgress(rows, { name: "qux.apk", received: 1, total: 2 })).toBe(rows);
  });

  it("returns the same reference when no row matches the payload name", () => {
    const rows: Record<string, DownloadPhase> = {
      "foo.apk": { phase: "downloading", received: 0, total: 100 },
    };
    expect(
      applyDownloadProgress(rows, { name: "other.apk", received: 50, total: 100 }),
    ).toBe(rows);
  });

  it("does not update a row keyed by the full blob name (bug B mechanism)", () => {
    const rows: Record<string, DownloadPhase> = {
      "APKs/foo.apk": { phase: "downloading", received: 0, total: 100 },
    };
    const next = applyDownloadProgress(rows, { name: "foo.apk", received: 40, total: 100 });
    expect(next).toBe(rows);
    expect(next["APKs/foo.apk"]).toEqual({ phase: "downloading", received: 0, total: 100 });
  });
});

describe("effectiveDirLabel", () => {
  it("shows the resolved directory when present", () => {
    expect(effectiveDirLabel(null, "/data/beholder/apks")).toBe("/data/beholder/apks");
    expect(effectiveDirLabel("~/Downloads/x", "/data/beholder/apks")).toBe(
      "/data/beholder/apks",
    );
  });

  it("falls back to the raw configured value when resolution is empty", () => {
    expect(effectiveDirLabel("~/Downloads/x", undefined)).toBe("~/Downloads/x");
    expect(effectiveDirLabel("~/Downloads/x", "")).toBe("~/Downloads/x");
    expect(effectiveDirLabel("apks", null)).toBe("apks");
  });

  it("renders nothing when both are empty", () => {
    expect(effectiveDirLabel(null, undefined)).toBe("");
    expect(effectiveDirLabel(undefined, null)).toBe("");
    expect(effectiveDirLabel("", "")).toBe("");
  });
});

describe("matchLocalFiles", () => {
  const foo: LocalApk = { name: "foo.apk", size_bytes: 100, path: "/data/apks/foo.apk" };

  function entry(name: string) {
    return { name } as ApkEntry;
  }

  it("returns matches keyed by local file name for downloaded entries", () => {
    expect(matchLocalFiles([entry("foo.apk"), entry("bar.apk")], [foo])).toEqual({
      "foo.apk": foo,
    });
  });

  it("omits entries with no local file", () => {
    expect(matchLocalFiles([entry("bar.apk"), entry("baz.apk")], [foo])).toEqual({});
  });

  it("keys a prefixed blob name to its local file name", () => {
    expect(matchLocalFiles([entry("APKs/foo.apk")], [foo])).toEqual({ "foo.apk": foo });
  });

  it("never matches degenerate entry names", () => {
    expect(matchLocalFiles([entry(""), entry("/"), entry(".")], [foo])).toEqual({});
  });
});
