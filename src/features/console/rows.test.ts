import { describe, expect, it } from "vitest";
import { buildExportText, buildRows, computeLineStats, filterEntries, formatLogLine } from "./rows";
import type { ConsoleEntry, LogLine } from "../../store/console-types";

function line(partial: Partial<LogLine> = {}): LogLine {
  return {
    ts_ms: 1,
    level: "Info",
    pid: 1,
    tid: 1,
    tag: "T",
    buffer: "Main",
    message: "m",
    is_crash: false,
    repeat_count: 1,
    ...partial,
  };
}

describe("buildRows", () => {
  it("collapses consecutive identical tag and message into one row", () => {
    const rows = buildRows([
      line({ tag: "A", message: "same" }),
      line({ tag: "A", message: "same" }),
      line({ tag: "A", message: "same" }),
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ kind: "line", repeatCount: 3 });
  });

  it("sums repeat_count fields of merged lines", () => {
    const rows = buildRows([
      line({ tag: "chatty", message: "ident expire 3 lines", repeat_count: 3 }),
      line({ tag: "chatty", message: "ident expire 3 lines", repeat_count: 2 }),
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ kind: "line", repeatCount: 5 });
  });

  it("does not collapse identical messages with different tags", () => {
    const rows = buildRows([
      line({ tag: "A", message: "same" }),
      line({ tag: "B", message: "same" }),
    ]);
    expect(rows.length).toBe(2);
  });

  it("does not collapse non-consecutive identical lines", () => {
    const rows = buildRows([
      line({ tag: "A", message: "same" }),
      line({ tag: "A", message: "other" }),
      line({ tag: "A", message: "same" }),
    ]);
    expect(rows.length).toBe(3);
  });

  it("preserves gap rows and breaks collapse runs across them", () => {
    const entries: ConsoleEntry[] = [
      line({ tag: "A", message: "same" }),
      { kind: "gap", dropped: 5 },
      line({ tag: "A", message: "same" }),
    ];
    const rows = buildRows(entries);
    expect(rows.length).toBe(3);
    expect(rows[1]).toEqual({ kind: "gap", dropped: 5 });
    expect(rows[0]).toMatchObject({ kind: "line", repeatCount: 1 });
    expect(rows[2]).toMatchObject({ kind: "line", repeatCount: 1 });
  });

  it("can disable collapsing via opts", () => {
    const rows = buildRows([line({ tag: "A", message: "same" }), line({ tag: "A", message: "same" })], {
      collapse: false,
    });
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ repeatCount: 1 });
  });

  it("keeps a lone chatty line as a single row with its multiplier", () => {
    const rows = buildRows([line({ tag: "chatty", message: "x", repeat_count: 12 })]);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ repeatCount: 12 });
  });
});

describe("formatLogLine", () => {
  const ts = new Date(2026, 7, 28, 9, 5, 3, 42).getTime();

  it("formats time, level, tag and pid", () => {
    const out = formatLogLine(line({ ts_ms: ts, level: "Warn", tag: "Metro", pid: 4521, message: "hi" }));
    expect(out).toBe("[09:05:03.042] Warn/Metro(4521): hi");
  });

  it("copies multi-line messages verbatim", () => {
    const message = "FATAL EXCEPTION: main\n  at com.foo.Bar.run(Bar.java:10)\nCaused by: boom";
    const out = formatLogLine(line({ ts_ms: ts, message }));
    expect(out).toBe(`[09:05:03.042] Info/T(1): ${message}`);
  });

  it("pads hours, minutes, seconds and milliseconds", () => {
    const padTs = new Date(2026, 7, 28, 0, 0, 0, 5).getTime();
    expect(formatLogLine(line({ ts_ms: padTs }))).toBe("[00:00:00.005] Info/T(1): m");
  });
});

describe("computeLineStats", () => {
  it("counts crashes, errors and warns from stored entries", () => {
    const entries: ConsoleEntry[] = [
      line({ is_crash: true, level: "Info" }),
      line({ level: "Error" }),
      line({ level: "Fatal" }),
      line({ level: "Warn" }),
      line({ level: "Warn" }),
      line({ level: "Info" }),
      { kind: "gap", dropped: 4 },
    ];
    expect(computeLineStats(entries)).toEqual({ crashes: 1, errors: 2, warns: 2 });
  });

  it("does not double count warn as error and skips gaps", () => {
    const entries: ConsoleEntry[] = [line({ level: "Warn", is_crash: true }), { kind: "gap", dropped: 1 }];
    const stats = computeLineStats(entries);
    expect(stats).toEqual({ crashes: 1, errors: 0, warns: 1 });
  });

  it("returns zeros for empty input", () => {
    expect(computeLineStats([])).toEqual({ crashes: 0, errors: 0, warns: 0 });
  });
});

describe("buildExportText", () => {
  const ts = new Date(2026, 7, 28, 14, 23, 1, 123).getTime();

  it("renders line rows in bracketed time level/tag(pid) format", () => {
    const rows = buildRows([
      line({ ts_ms: ts, level: "Error", tag: "ReactNativeJS", pid: 4521, message: "boom" }),
    ]);
    expect(buildExportText(rows)).toBe("[14:23:01.123] Error/ReactNativeJS(4521): boom");
  });

  it("renders gap rows with the dropped count", () => {
    const entries: ConsoleEntry[] = [line({ ts_ms: ts }), { kind: "gap", dropped: 5 }, line({ ts_ms: ts })];
    const rows = buildRows(entries);
    expect(buildExportText(rows).split("\n")[1]).toBe("--- gap: 5 lines dropped ---");
  });

  it("includes the full multi-line stack of crash rows", () => {
    const rows = buildRows([
      line({
        ts_ms: ts,
        is_crash: true,
        tag: "AndroidRuntime",
        message: "FATAL EXCEPTION: main\n  at com.foo.Bar.run(Bar.java:10)\nCaused by: java.lang.NullPointerException",
      }),
    ]);
    expect(buildExportText(rows)).toBe(
      "[14:23:01.123] Info/AndroidRuntime(1): FATAL EXCEPTION: main\n  at com.foo.Bar.run(Bar.java:10)\nCaused by: java.lang.NullPointerException",
    );
  });

  it("joins rows with newlines and returns empty text for no rows", () => {
    expect(buildExportText([])).toBe("");
    const rows = buildRows([line({ ts_ms: ts, message: "a" }), line({ ts_ms: ts, message: "b" })]);
    expect(buildExportText(rows)).toBe(
      `[14:23:01.123] Info/T(1): a\n[14:23:01.123] Info/T(1): b`,
    );
  });
});

describe("filterEntries", () => {
  const entries: ConsoleEntry[] = [
    line({ pid: 10, level: "Verbose", tag: "SystemUI", message: "v" }),
    line({ pid: 10, level: "Info", tag: "ReactNativeJS", message: "hello" }),
    line({ pid: 20, level: "Warn", tag: "unknown:ReactNativeJS", message: "w" }),
    line({ pid: 20, level: "Error", tag: "Other", message: "boom" }),
    { kind: "gap", dropped: 3 },
  ];

  it("filters by minimum level inclusively and keeps gaps", () => {
    const out = filterEntries(entries, { pid: null, tag: null, minLevel: "Warn" }, null);
    expect(out).toHaveLength(3);
    expect(out.map((e) => (e as LogLine).level)).toEqual(["Warn", "Error", undefined]);
  });

  it("filters by pid", () => {
    const out = filterEntries(entries, { pid: 10, tag: null, minLevel: null }, null);
    expect(out.filter(isLog).every((l) => l.pid === 10)).toBe(true);
  });

  it("matches tag exactly, via unknown prefix and case-insensitively", () => {
    const out = filterEntries(entries, { pid: null, tag: "reactnativejs", minLevel: null }, null);
    expect(out.filter(isLog).map((l) => l.tag)).toEqual(["ReactNativeJS", "unknown:ReactNativeJS"]);
  });

  it("combines with regex over the message", () => {
    const out = filterEntries(entries, { pid: null, tag: null, minLevel: null }, /boom/);
    expect(out.filter(isLog).map((l) => l.message)).toEqual(["boom"]);
  });

  it("blank tag disables tag filtering", () => {
    const out = filterEntries(entries, { pid: null, tag: "   ", minLevel: null }, null);
    expect(out.filter(isLog)).toHaveLength(4);
  });
});

function isLog(e: ConsoleEntry): e is LogLine {
  return !("kind" in e);
}
