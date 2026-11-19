export interface AgentToolInfo {
  name: string;
  description: string;
}

export interface AgentConnections {
  enabled: boolean;
  active: number;
  last_seen_ms: number | null;
  total: number;
  recent: boolean;
}

export interface AgentBridgeStatus {
  enabled: boolean;
  port: number | null;
  discovery_path: string;
  focus_app: string | null;
  pins_count: number;
  mcp_command: string;
  tools: AgentToolInfo[];
  connections: AgentConnections;
}

export function bridgeStatusLine(status: AgentBridgeStatus): string {
  if (!status.enabled) return "Disabled — no MCP client can connect";
  return status.port != null
    ? `Active — agents can connect on port ${status.port}`
    : "Active";
}

export function formatBridgeInfo(status: AgentBridgeStatus): string {
  return `${status.tools.length} tools · focus: ${status.focus_app ?? "none"} · ${status.pins_count} pins`;
}

export function lastSeenLabel(ms: number, now: number): string {
  const elapsed = Math.max(0, now - ms);
  if (elapsed < 5_000) return "just now";
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1_000)}s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  return `${Math.floor(elapsed / 3_600_000)}h ago`;
}

export function connectionsLine(c: AgentConnections, now: number): string {
  if (!c.enabled) return "Bridge off";
  if (c.recent && c.active > 0) {
    const plural = c.active === 1 ? "request" : "requests";
    return `${c.active} agent ${plural} in flight`;
  }
  if (c.recent && c.last_seen_ms != null) {
    return `Agent connected · last seen ${lastSeenLabel(c.last_seen_ms, now)}`;
  }
  if (c.total > 0 && c.last_seen_ms != null) {
    return `No agent connected · last activity ${lastSeenLabel(c.last_seen_ms, now)}`;
  }
  return "No agent has connected yet";
}

export function isAgentClientActive(
  c: AgentConnections | null | undefined,
): boolean {
  return Boolean(c && c.enabled && c.recent);
}
