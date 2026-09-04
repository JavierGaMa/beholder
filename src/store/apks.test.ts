import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApks } from "./apks";
import { invoke } from "../lib/tauri";
import type { ApkEntry } from "./types";

vi.mock("../lib/tauri", () => ({
  isTauri: false,
  invoke: vi.fn(async () => undefined),
}));

const apks: ApkEntry[] = [
  {
    name: "advisor-v2.0.12-QA-build-2012-release.apk",
    url: "https://example.dev/advisor-v2.0.12.apk",
    version: "2.0.12",
    env: "QA",
    build: 2012,
    flavor: "release",
    date: "10-07-2026",
    size_bytes: 85_689_296,
    last_modified: "Fri, 10 Jul 2026 09:12:44 GMT",
  },
];

function mockList(list: ApkEntry[]) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) =>
    cmd === "list_apks" ? (list as never) : (undefined as never),
  );
}

function deferredList() {
  let release!: (list: ApkEntry[]) => void;
  const promise = new Promise<ApkEntry[]>((resolve) => {
    release = resolve;
  });
  vi.mocked(invoke).mockImplementation(() => promise as never);
  return release;
}

beforeEach(() => {
  useApks.setState(useApks.getInitialState(), true);
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("apks store refresh", () => {
  it("fetches the listing on first refresh", async () => {
    mockList(apks);
    await useApks.getState().refresh();
    const st = useApks.getState();
    expect(st.status).toBe("ready");
    expect(st.entries).toEqual(apks);
    expect(st.error).toBeNull();
    expect(st.lastFetched).not.toBeNull();
    expect(invoke).toHaveBeenCalledWith("list_apks");
  });

  it("deduplicates concurrent refresh calls into one in-flight fetch", async () => {
    const release = deferredList();
    const first = useApks.getState().refresh();
    const second = useApks.getState().refresh();
    expect(invoke).toHaveBeenCalledTimes(1);
    release(apks);
    await Promise.all([first, second]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(useApks.getState().entries).toEqual(apks);
  });

  it("serves cached data within the TTL and refetches once stale", async () => {
    mockList(apks);
    await useApks.getState().refresh();
    vi.mocked(invoke).mockClear();
    await useApks.getState().refresh();
    expect(invoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(61_000);
    await useApks.getState().refresh();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(useApks.getState().entries).toEqual(apks);
  });

  it("keeps cached entries visible while a stale refresh is in flight", async () => {
    mockList(apks);
    await useApks.getState().refresh();
    vi.advanceTimersByTime(61_000);
    const next: ApkEntry[] = [
      {
        name: "advisor-v3.0.0-PROD-build-3000-release.apk",
        url: "https://example.dev/advisor-v3.0.0.apk",
        version: "3.0.0",
        env: "PROD",
        build: 3000,
        flavor: "release",
        date: "01-08-2026",
        size_bytes: 220_145_971,
        last_modified: "Sat, 01 Aug 2026 10:00:00 GMT",
      },
    ];
    const release = deferredList();
    const pending = useApks.getState().refresh();
    expect(useApks.getState().entries).toEqual(apks);
    expect(useApks.getState().refreshing).toBe(true);
    release(next);
    await pending;
    const st = useApks.getState();
    expect(st.entries).toEqual(next);
    expect(st.refreshing).toBe(false);
  });

  it("force bypasses the TTL for the manual refresh button", async () => {
    mockList(apks);
    await useApks.getState().refresh();
    vi.mocked(invoke).mockClear();
    await useApks.getState().refresh(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("surfaces refresh errors while keeping cached entries", async () => {
    mockList(apks);
    await useApks.getState().refresh();
    vi.mocked(invoke).mockRejectedValue(new Error("container unreachable"));
    await useApks.getState().refresh(true);
    const st = useApks.getState();
    expect(st.error).toBe("container unreachable");
    expect(st.status).toBe("ready");
    expect(st.entries).toEqual(apks);
    expect(st.refreshing).toBe(false);
  });

  it("reports an error state when the first load fails and recovers afterwards", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("container unreachable"));
    await useApks.getState().refresh();
    const failed = useApks.getState();
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("container unreachable");
    mockList(apks);
    await useApks.getState().refresh();
    const st = useApks.getState();
    expect(st.status).toBe("ready");
    expect(st.error).toBeNull();
    expect(st.entries).toEqual(apks);
  });
});
