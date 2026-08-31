import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConsole } from "./console";
import { useTraffic } from "./traffic";
import { DEFAULT_CONFIG } from "../lib/theme/config-types";
import type { LogLine } from "./console-types";
import { invoke } from "../lib/tauri";

vi.mock("../lib/tauri", () => ({
  isTauri: false,
  invoke: vi.fn(async () => undefined),
}));

function line(partial: Partial<LogLine> = {}): LogLine {
  return {
    ts_ms: 1,
    level: "Info",
    pid: 100,
    tid: 200,
    tag: "T",
    buffer: "Main",
    message: "m",
    is_crash: false,
    repeat_count: 1,
    ...partial,
  };
}

function setRingLines(n: number) {
  useTraffic.setState({ uiConfig: { ...DEFAULT_CONFIG, console: { ...DEFAULT_CONFIG.console!, ring_lines: n } } });
}

beforeEach(() => {
  useConsole.setState(useConsole.getInitialState(), true);
  useTraffic.setState({ uiConfig: null });
  vi.clearAllMocks();
});

afterEach(() => {
  useTraffic.setState({ uiConfig: null });
});

describe("console store ingest", () => {
  it("appends line events", () => {
    useConsole.getState().ingest([
      { Line: line({ tag: "A", message: "a" }) },
      { Line: line({ tag: "B", message: "b" }) },
    ]);
    const st = useConsole.getState();
    expect(st.lines.length).toBe(2);
    expect(st.lines[0]).toMatchObject({ tag: "A", message: "a" });
    expect(st.running).toBe(false);
  });

  it("evicts oldest lines beyond the ring cap", () => {
    setRingLines(3);
    useConsole.getState().ingest(
      [1, 2, 3, 4, 5].map((i) => ({ Line: line({ tag: `T${i}`, message: `m${i}` }) })),
    );
    const st = useConsole.getState();
    expect(st.lines.length).toBe(3);
    expect(st.lines.map((l) => (l as LogLine).tag)).toEqual(["T3", "T4", "T5"]);
  });

  it("discards lines while paused and inserts a gap row on resume", () => {
    const store = useConsole.getState();
    store.ingest([{ Line: line({ tag: "A", message: "a" }) }]);
    store.setPaused(true);
    store.ingest([
      { Line: line({ tag: "B", message: "b" }) },
      { Line: line({ tag: "C", message: "c" }) },
    ]);
    let st = useConsole.getState();
    expect(st.lines.length).toBe(1);
    expect(st.pausedDropCount).toBe(2);
    useConsole.getState().setPaused(false);
    st = useConsole.getState();
    expect(st.pausedDropCount).toBe(0);
    expect(st.lines.length).toBe(2);
    expect(st.lines[1]).toEqual({ kind: "gap", dropped: 2 });
  });

  it("does not insert a gap row when nothing was dropped", () => {
    useConsole.getState().setPaused(true);
    useConsole.getState().setPaused(false);
    expect(useConsole.getState().lines).toEqual([]);
  });

  it("keeps counting drops across multiple batches while paused", () => {
    const store = useConsole.getState();
    store.setPaused(true);
    store.ingest([{ Line: line() }]);
    store.ingest([{ Line: line() }, { Line: line() }]);
    expect(useConsole.getState().pausedDropCount).toBe(3);
  });

  it("flips running on status events", () => {
    useConsole.getState().ingest([{ Status: "Streaming" }]);
    expect(useConsole.getState().running).toBe(true);
    expect(useConsole.getState().status).toBe("Streaming");
    useConsole.getState().ingest([{ Status: "Disconnected" }]);
    expect(useConsole.getState().running).toBe(false);
    useConsole.getState().ingest([{ Status: { Failed: "adb not found" } }]);
    const st = useConsole.getState();
    expect(st.running).toBe(false);
    expect(st.status).toEqual({ Failed: "adb not found" });
    useConsole.getState().ingest([{ Status: "Stopped" }]);
    expect(useConsole.getState().status).toBe("Stopped");
  });

  it("dedupes observed tags from ingested lines", () => {
    useConsole.getState().ingest([
      { Line: line({ tag: "A" }) },
      { Line: line({ tag: "B" }) },
      { Line: line({ tag: "A" }) },
    ]);
    expect(useConsole.getState().observedTags).toEqual(["A", "B"]);
  });

  it("clear empties lines without touching the stream state", () => {
    const store = useConsole.getState();
    store.ingest([{ Status: "Streaming" }, { Line: line() }]);
    store.clear();
    const st = useConsole.getState();
    expect(st.lines).toEqual([]);
    expect(st.running).toBe(true);
  });

  it("validates regex input", () => {
    useConsole.getState().setRegex("[unclosed");
    expect(useConsole.getState().regexError).toBeTruthy();
    useConsole.getState().setRegex("ok(pattern)?");
    expect(useConsole.getState().regexError).toBeNull();
    useConsole.getState().setRegex("");
    expect(useConsole.getState().regexError).toBeNull();
  });
});

describe("console store server filter sync", () => {
  it("level and tag changes stay client-side without invoking", () => {
    useConsole.getState().setMinLevel("Warn");
    useConsole.getState().setTagQuery("ReactNativeJS");
    expect(invoke).not.toHaveBeenCalled();
    expect(useConsole.getState().minLevel).toBe("Warn");
    expect(useConsole.getState().tagQuery).toBe("ReactNativeJS");
  });

  it("start and stop invoke console commands", () => {
    useConsole.getState().start("emulator-5554", ["main", "system", "crash"]);
    expect(invoke).toHaveBeenCalledWith("console_start", {
      serial: "emulator-5554",
      buffers: ["main", "system", "crash"],
    });
    expect(useConsole.getState().serial).toBe("emulator-5554");
    useConsole.getState().stop();
    expect(invoke).toHaveBeenCalledWith("console_stop");
  });

  it("setAppFilter pushes server filter with the app pid and clears it", () => {
    useConsole.getState().setAppFilter({ package: "com.foo", pid: 4521 });
    expect(useConsole.getState().appFilter).toEqual({ package: "com.foo", pid: 4521 });
    expect(invoke).toHaveBeenCalledWith("console_set_filter", {
      filter: { pid: 4521, min_level: null, tags: [] },
    });
    useConsole.getState().setAppFilter(null);
    expect(useConsole.getState().appFilter).toBeNull();
    expect(invoke).toHaveBeenLastCalledWith("console_set_filter", {
      filter: { pid: null, min_level: null, tags: [] },
    });
  });

  it("level changes after an app filter do not re-push server state", () => {
    useConsole.getState().setAppFilter({ package: "com.foo", pid: 4521 });
    vi.mocked(invoke).mockClear();
    useConsole.getState().setMinLevel("Warn");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("setColumns", () => {
  it("patches individual columns and preserves the rest", () => {
    useConsole.setState({ columns: { time: false, level: true, tag: false, pid: false, tid: false } });
    useConsole.getState().setColumns({ time: true, tag: true });
    expect(useConsole.getState().columns).toEqual({ time: true, level: true, tag: true, pid: false, tid: false });
    useConsole.getState().setColumns({ level: false });
    expect(useConsole.getState().columns).toEqual({ time: true, level: false, tag: true, pid: false, tid: false });
    useConsole.setState({ columns: { time: false, level: true, tag: false, pid: false, tid: false } });
  });
});
