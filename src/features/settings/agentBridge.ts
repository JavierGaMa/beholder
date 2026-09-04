export interface AgentBridgeStatus {
  enabled: boolean;
  port: number | null;
  discovery_path: string;
  focus_app: string | null;
  pins_count: number;
}

export const MCP_TOOL_COUNT = 6;

export function bridgeStatusLine(status: AgentBridgeStatus): string {
  if (!status.enabled) return "Disabled — no MCP client can connect";
  return status.port != null
    ? `Active — agents can connect on port ${status.port}`
    : "Active";
}

export function formatBridgeInfo(status: AgentBridgeStatus): string {
  return `${MCP_TOOL_COUNT} tools · focus: ${status.focus_app ?? "none"} · ${status.pins_count} pins`;
}
