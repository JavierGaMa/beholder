import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPaletteCommands, searchCommands, type PaletteHandlers } from "./commands";
import { useTraffic, type View } from "../../store/traffic";
import type { TrafficEvent } from "../../store/types";

const VIEWS: View[] = [
  "requests",
  "websockets",
  "metrics",
  "emulators",
  "apks",
  "database",
  "console",
];

const handlers = (): PaletteHandlers => ({
  toggleSidebar: vi.fn(),
  toggleFollow: vi.fn(),
  focusSearch: vi.fn(),
});

const started = (id: number): TrafficEvent => ({
  type: "ExchangeStarted",
  id,
  request: {
    method: "GET",
    url: `https://a.dev/${id}`,
    host: "a.dev",
    path: `/${id}`,
    headers: [],
    body: null,
    started_at: 1,
  },
});

beforeEach(() => {
  useTraffic.getState().clear();
  useTraffic.setState({ activeView: "requests", settingsOpen: false });
});

describe("palette command registry", () => {
  it("has a navigate command for every view", () => {
    const cmds = buildPaletteCommands(handlers());
    for (const view of VIEWS) {
      const cmd = cmds.find((c) => c.id === `go-to-${view}`);
      expect(cmd, view).toBeDefined();
      expect(cmd?.section).toBe("Navigate");
    }
  });

  it("lists every Navigate command before every Actions command", () => {
    const cmds = buildPaletteCommands(handlers());
    const sections = cmds.map((c) => c.section);
    const firstActions = sections.indexOf("Actions");
    expect(firstActions).toBeGreaterThan(0);
    expect(sections.slice(0, firstActions)).toEqual(
      Array(firstActions).fill("Navigate"),
    );
    expect(sections.slice(firstActions)).toEqual(Array(sections.length - firstActions).fill("Actions"));
  });

  it("wires handler-backed actions to the provided callbacks", () => {
    const h = handlers();
    const cmds = buildPaletteCommands(h);
    cmds.find((c) => c.id === "toggle-sidebar")?.run();
    cmds.find((c) => c.id === "toggle-follow")?.run();
    cmds.find((c) => c.id === "focus-search")?.run();
    expect(h.toggleSidebar).toHaveBeenCalledTimes(1);
    expect(h.toggleFollow).toHaveBeenCalledTimes(1);
    expect(h.focusSearch).toHaveBeenCalledTimes(1);
  });

  it("navigates to the target view on run", () => {
    buildPaletteCommands(handlers()).find((c) => c.id === "go-to-websockets")?.run();
    expect(useTraffic.getState().activeView).toBe("websockets");
  });

  it("opens settings on run", () => {
    buildPaletteCommands(handlers()).find((c) => c.id === "open-settings")?.run();
    expect(useTraffic.getState().settingsOpen).toBe(true);
  });

  it("registers an MCP config copy action", () => {
    const cmd = buildPaletteCommands(handlers()).find((c) => c.id === "copy-mcp-config");
    expect(cmd?.section).toBe("Actions");
    expect(cmd?.label).toBe("Copy MCP Config");
  });

  it("clears captured requests on run", () => {
    useTraffic.getState().ingest([started(1)]);
    expect(useTraffic.getState().order.length).toBe(1);
    buildPaletteCommands(handlers()).find((c) => c.id === "clear-requests")?.run();
    expect(useTraffic.getState().order.length).toBe(0);
  });
});

describe("searchCommands", () => {
  it("returns every command in registry order for an empty query", () => {
    const cmds = buildPaletteCommands(handlers());
    expect(searchCommands(cmds, "   ").map((c) => c.id)).toEqual(cmds.map((c) => c.id));
  });

  it("filters by label and ranks the best match first", () => {
    const results = searchCommands(buildPaletteCommands(handlers()), "req");
    expect(results[0]?.id).toBe("go-to-requests");
    expect(results.every((c) => c.label.toLowerCase().includes("req") || c.id !== "go-to-requests")).toBe(true);
    expect(results.find((c) => c.id === "go-to-console")).toBeUndefined();
  });

  it("matches scattered label characters", () => {
    const results = searchCommands(buildPaletteCommands(handlers()), "stg");
    expect(results.some((c) => c.id === "go-to-settings")).toBe(false);
    expect(results.map((c) => c.id)).toContain("open-settings");
  });

  it("returns an empty array when nothing matches", () => {
    expect(searchCommands(buildPaletteCommands(handlers()), "zzz")).toEqual([]);
  });

  it("floats recent commands to the front of their section on an empty query", () => {
    const cmds = buildPaletteCommands(handlers());
    const ordered = searchCommands(cmds, "", ["clear-requests", "go-to-metrics"]);
    expect(ordered[0]?.id).toBe("go-to-metrics");
    expect(ordered[7]?.id).toBe("clear-requests");
    expect(ordered[8]?.id).toBe("open-settings");
  });
});
