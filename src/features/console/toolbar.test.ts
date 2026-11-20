import { describe, expect, it } from "vitest";
import { crashSummary, severityOptions, showLogFilters, streamPill } from "./toolbar";

describe("showLogFilters", () => {
  it("shows level, tag, regex and app filters in logs mode", () => {
    expect(showLogFilters("logs")).toBe(true);
  });

  it("hides them in timeline mode because the timeline ignores them", () => {
    expect(showLogFilters("timeline")).toBe(false);
  });
});

describe("severityOptions", () => {
  const opts = severityOptions(1284, { crashes: 1, errors: 3, warns: 14 });

  it("lists the four severity choices in order with their minimum level", () => {
    expect(opts.map((o) => [o.label, o.level])).toEqual([
      ["All", null],
      ["Info and up", "Info"],
      ["Warnings", "Warn"],
      ["Errors", "Error"],
    ]);
  });

  it("carries the live counts inside the segments", () => {
    expect(opts.map((o) => o.count)).toEqual([1284, null, 14, 3]);
  });

  it("offers short labels for narrow toolbars", () => {
    expect(opts.map((o) => o.short)).toEqual(["All", "Info+", "Warn+", "Error+"]);
  });

  it("keeps the existing titles", () => {
    expect(opts.map((o) => o.title)).toEqual([
      "Show all log levels",
      "Show Info and above",
      "Show Warn and above",
      "Show Error and above",
    ]);
  });
});

describe("streamPill", () => {
  it("pulses an accent dot while streaming", () => {
    expect(streamPill("Streaming")).toEqual({ text: "Streaming", tone: "accent", pulse: true });
  });

  it("shows Retrying in warn tone when disconnected", () => {
    expect(streamPill("Disconnected")).toEqual({ text: "Retrying", tone: "warn", pulse: false });
  });

  it("shows Failed in danger tone on failure", () => {
    expect(streamPill({ Failed: "adb not found" })).toEqual({ text: "Failed", tone: "danger", pulse: false });
  });

  it("shows Stopped in muted tone when stopped", () => {
    expect(streamPill("Stopped")).toEqual({ text: "Stopped", tone: "muted", pulse: false });
  });
});

describe("crashSummary", () => {
  it("uses the exception line after a FATAL EXCEPTION header", () => {
    expect(
      crashSummary("FATAL EXCEPTION: main\njava.lang.IllegalStateException: boom\n  at a.b(C.java:1)"),
    ).toBe("java.lang.IllegalStateException: boom");
  });

  it("keeps the header when nothing follows it", () => {
    expect(crashSummary("FATAL EXCEPTION: main")).toBe("FATAL EXCEPTION: main");
  });

  it("uses the first line for ANR messages", () => {
    expect(crashSummary("ANR in com.shop.app\nReason: Input dispatching timed out")).toBe("ANR in com.shop.app");
  });

  it("skips a Process line between the header and the exception", () => {
    expect(
      crashSummary("FATAL EXCEPTION: main\nProcess: com.shop.app, PID: 4821\njava.lang.RuntimeException: x"),
    ).toBe("java.lang.RuntimeException: x");
  });
});
