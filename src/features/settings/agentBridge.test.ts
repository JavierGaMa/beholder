import { describe, expect, it } from "vitest";
import {
  bridgeDetailsLine,
  connectionsLine,
  isAgentClientActive,
  lastSeenLabel,
  type AgentBridgeStatus,
  type AgentConnections,
  type AgentToolInfo,
} from "./agentBridge";

const TOOLS: AgentToolInfo[] = [
  { name: "beholder_focus", description: "Current focus and counts" },
  { name: "beholder_requests", description: "Compact request lines" },
  { name: "beholder_console", description: "Recent console lines" },
];

function connections(over: Partial<AgentConnections> = {}): AgentConnections {
  return {
    enabled: true,
    active: 0,
    last_seen_ms: null,
    total: 0,
    recent: false,
    ...over,
  };
}

function status(over: Partial<AgentBridgeStatus> = {}): AgentBridgeStatus {
  return {
    enabled: true,
    port: 41234,
    discovery_path: "/home/dev/.beholder/agent.json",
    focus_app: null,
    pins_count: 0,
    mcp_command: "/opt/beholder/bin/beholder-mcp",
    tools: TOOLS,
    connections: connections(),
    ...over,
  };
}

describe("bridgeDetailsLine", () => {
  it("lists the port, focus app and pin count", () => {
    expect(
      bridgeDetailsLine(status({ focus_app: "com.example.app", pins_count: 3 })),
    ).toBe("port 41234 · focus com.example.app · 3 pins");
  });

  it("falls back to none when no app is focused", () => {
    expect(bridgeDetailsLine(status())).toBe("port 41234 · focus none · 0 pins");
  });

  it("marks an unassigned port", () => {
    expect(bridgeDetailsLine(status({ port: null }))).toBe(
      "port unassigned · focus none · 0 pins",
    );
  });
});

describe("lastSeenLabel", () => {
  const NOW = 1_000_000;

  it("labels activity within five seconds as just now", () => {
    expect(lastSeenLabel(NOW - 4_999, NOW)).toBe("just now");
    expect(lastSeenLabel(NOW, NOW)).toBe("just now");
  });

  it("labels seconds, minutes and hours", () => {
    expect(lastSeenLabel(NOW - 15_000, NOW)).toBe("15s ago");
    expect(lastSeenLabel(NOW - 61_000, NOW)).toBe("1m ago");
    expect(lastSeenLabel(NOW - 7_200_000, NOW)).toBe("2h ago");
  });

  it("never reports a negative age", () => {
    expect(lastSeenLabel(NOW + 10_000, NOW)).toBe("just now");
  });
});

describe("connectionsLine", () => {
  const NOW = 1_000_000;

  it("reports in-flight agent requests", () => {
    expect(
      connectionsLine(connections({ recent: true, active: 2 }), NOW),
    ).toBe("2 agent requests in flight");
  });

  it("uses the singular form for one in-flight request", () => {
    expect(
      connectionsLine(connections({ recent: true, active: 1 }), NOW),
    ).toBe("1 agent request in flight");
  });

  it("reports a recently active agent with its last-seen age", () => {
    expect(
      connectionsLine(
        connections({ recent: true, total: 4, last_seen_ms: NOW - 3_000 }),
        NOW,
      ),
    ).toBe("Agent connected · last seen just now");
  });

  it("reports idle state with the last activity age", () => {
    expect(
      connectionsLine(
        connections({ total: 5, last_seen_ms: NOW - 90_000 }),
        NOW,
      ),
    ).toBe("No agent connected · last activity 1m ago");
  });

  it("reports never-connected state", () => {
    expect(connectionsLine(connections(), NOW)).toBe(
      "No agent has connected yet",
    );
  });

  it("reports a disabled bridge", () => {
    expect(connectionsLine(connections({ enabled: false }), NOW)).toBe(
      "Bridge off",
    );
  });
});

describe("isAgentClientActive", () => {
  it("is true only when enabled and recent", () => {
    expect(isAgentClientActive(connections({ recent: true }))).toBe(true);
    expect(isAgentClientActive(connections({ recent: false }))).toBe(false);
    expect(
      isAgentClientActive(connections({ enabled: false, recent: true })),
    ).toBe(false);
  });

  it("is false for missing state", () => {
    expect(isAgentClientActive(null)).toBe(false);
    expect(isAgentClientActive(undefined)).toBe(false);
  });
});
