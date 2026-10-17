import { describe, expect, it } from "vitest";
import {
  MAX_LOG_LINES,
  EMPTY_LOG,
  appendLog,
  logFootnote,
} from "./logStream";

describe("appendLog", () => {
  it("appends while under the cap", () => {
    let page = EMPTY_LOG;
    page = appendLog(page, "one");
    page = appendLog(page, "two");
    expect(page).toEqual({ lines: ["one", "two"], dropped: 0 });
  });

  it("does not mutate the input page", () => {
    const page = { lines: ["one"], dropped: 0 };
    const next = appendLog(page, "two");
    expect(page.lines).toEqual(["one"]);
    expect(next.lines).toEqual(["one", "two"]);
  });

  it("drops oldest lines once the cap is reached", () => {
    let page: import("./logStream").LogPage = EMPTY_LOG;
    for (let i = 0; i < MAX_LOG_LINES + 3; i += 1) {
      page = appendLog(page, `line-${i}`);
    }
    expect(page.lines.length).toBe(MAX_LOG_LINES);
    expect(page.lines[0]).toBe(`line-${MAX_LOG_LINES + 3 - MAX_LOG_LINES}`);
    expect(page.lines[page.lines.length - 1]).toBe(`line-${MAX_LOG_LINES + 2}`);
    expect(page.dropped).toBe(3);
  });

  it("honours a custom cap", () => {
    let page = EMPTY_LOG;
    page = appendLog(page, "a", 2);
    page = appendLog(page, "b", 2);
    page = appendLog(page, "c", 2);
    expect(page).toEqual({ lines: ["b", "c"], dropped: 1 });
  });
});

describe("logFootnote", () => {
  it("reports an empty log", () => {
    expect(logFootnote(EMPTY_LOG)).toBe("no output yet");
  });

  it("reports the line count", () => {
    expect(logFootnote({ lines: ["a", "b"], dropped: 0 })).toBe("2 lines");
  });

  it("mentions dropped lines", () => {
    expect(logFootnote({ lines: ["a"], dropped: 7 })).toBe("1 lines · 7 older dropped");
  });
});
