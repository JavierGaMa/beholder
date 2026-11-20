import { describe, expect, it } from "vitest";
import type { ApkEntry } from "../../store/types";
import { envCounts, rowAction } from "./apksList";

function entry(name: string, env: string | null): ApkEntry {
  return {
    name,
    url: `https://example.dev/${name}`,
    version: "1.0.0",
    env,
    build: 1,
    flavor: "release",
    date: null,
    size_bytes: 10,
    last_modified: "Mon, 07 Jul 2026 09:12:44 GMT",
  };
}

describe("envCounts", () => {
  const entries = [
    entry("app-qa-1.apk", "QA"),
    entry("app-qa-2.apk", "QA"),
    entry("app-prod-1.apk", "PROD"),
    entry("other-dev.apk", null),
  ];

  it("counts every environment without a query", () => {
    expect(envCounts(entries, "")).toEqual({ all: 4, QA: 2, PROD: 1 });
  });

  it("applies the search query to every count", () => {
    expect(envCounts(entries, "app")).toEqual({ all: 3, QA: 2, PROD: 1 });
    expect(envCounts(entries, "prod")).toEqual({ all: 1, QA: 0, PROD: 1 });
  });
});

describe("rowAction", () => {
  it("shows progress while downloading", () => {
    expect(rowAction({ phase: "downloading", received: 50, total: 200 })).toEqual({
      kind: "progress",
      pct: 25,
    });
  });

  it("maps the remaining phases", () => {
    expect(rowAction({ phase: "installing" })).toEqual({ kind: "installing" });
    expect(rowAction({ phase: "done" })).toEqual({ kind: "installed" });
    expect(rowAction({ phase: "error", message: "boom" })).toEqual({ kind: "retry", message: "boom" });
    expect(rowAction({ phase: "idle" })).toEqual({ kind: "install" });
  });
});
