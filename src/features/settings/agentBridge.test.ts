import { describe, expect, it } from "vitest";
import {
  bridgeStatusLine,
  formatBridgeInfo,
  type AgentBridgeStatus,
} from "./agentBridge";

function status(over: Partial<AgentBridgeStatus> = {}): AgentBridgeStatus {
  return {
    enabled: true,
    port: 41234,
    discovery_path: "/home/dev/.beholder/agent.json",
    focus_app: null,
    pins_count: 0,
    ...over,
  };
}

describe("bridgeStatusLine", () => {
  it("describes the active bridge with its port", () => {
    expect(bridgeStatusLine(status())).toBe(
      "Active — agents can connect on port 41234",
    );
  });

  it("describes the disabled bridge", () => {
    expect(bridgeStatusLine(status({ enabled: false, port: null }))).toBe(
      "Disabled — no MCP client can connect",
    );
  });
});

describe("formatBridgeInfo", () => {
  it("shows the focused package and pin count", () => {
    expect(
      formatBridgeInfo(status({ focus_app: "com.example.app", pins_count: 3 })),
    ).toBe("6 tools · focus: com.example.app · 3 pins");
  });

  it("falls back to none when no app is focused", () => {
    expect(formatBridgeInfo(status())).toBe("6 tools · focus: none · 0 pins");
  });
});
