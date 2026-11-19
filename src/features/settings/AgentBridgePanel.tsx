import { useEffect, useState } from "react";
import clsx from "clsx";
import { Bot, Copy } from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import { toast } from "../../components/ui/toast";
import { Panel } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { Toggle } from "../../components/ui/Toggle";
import {
  bridgeStatusLine,
  connectionsLine,
  formatBridgeInfo,
  isAgentClientActive,
  type AgentBridgeStatus,
  type AgentConnections,
} from "./agentBridge";
import { buildMcpSnippets, tokenHandlingNote } from "./agentSnippets";

export function AgentBridgePanel() {
  const [status, setStatus] = useState<AgentBridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isTauri) return;
    invoke<AgentBridgeStatus>("agent_bridge_status")
      .then(setStatus)
      .catch(() => setStatus(null));
    let dispose: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<AgentConnections>("agent-connections", (e) => {
        setNow(Date.now());
        setStatus((prev) => (prev ? { ...prev, connections: e.payload } : prev));
      }).then((un) => {
        dispose = un;
      });
    });
    return () => dispose?.();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  async function refreshStatus() {
    const next = await invoke<AgentBridgeStatus>("agent_bridge_status");
    setStatus(next);
    setNow(Date.now());
  }

  async function toggleEnabled() {
    if (!status || busy) return;
    setBusy(true);
    try {
      await invoke("agent_set_enabled", { enabled: !status.enabled });
      await refreshStatus();
    } catch (e) {
      toast(String(e), "danger");
    } finally {
      setBusy(false);
    }
  }

  function copyText(text: string, message: string) {
    navigator.clipboard.writeText(text).then(
      () => toast(message),
      () => toast("Clipboard unavailable", "danger"),
    );
  }

  const enabled = status?.enabled ?? false;
  const connections = status?.connections ?? null;
  const active = isAgentClientActive(connections);
  const snippets = status
    ? buildMcpSnippets({
        command: status.mcp_command,
        discoveryPath: status.discovery_path,
      })
    : [];

  return (
    <>
      <Panel className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium text-txt">Agent bridge</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Lets MCP agents query captured traffic and console logs over a local
              HTTP API.
            </p>
          </div>
          <Toggle
            checked={enabled}
            onChange={() => void toggleEnabled()}
            disabled={busy || !status}
            label="Enable agent bridge"
          />
        </div>
        {status && (
          <>
            <p className={clsx("mt-2 text-[11px]", enabled ? "text-ok" : "text-muted")}>
              {bridgeStatusLine(status)}
            </p>
            <p className={clsx("mt-1 text-[11px]", active ? "text-ok" : "text-muted")}>
              {connectionsLine(status.connections, now)}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-line bg-bg px-2 py-1 font-mono text-[11px] text-muted">
                {status.discovery_path}
              </code>
              <Button
                variant="ghost"
                size="sm"
                icon={Copy}
                className="shrink-0"
                aria-label="Copy discovery path"
                onClick={() => copyText(status.discovery_path, "Discovery path copied to clipboard")}
              >
                Copy
              </Button>
            </div>
            <p className="mt-2 font-mono text-[11px] text-muted">
              {formatBridgeInfo(status)}
            </p>
          </>
        )}
      </Panel>

      {status && (
        <Panel className="p-4">
          <p className="text-[12px] font-medium text-txt">Exposed tools</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Served by the beholder-mcp sidecar over the stdio MCP protocol.
          </p>
          <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {status.tools.map((tool) => (
              <li key={tool.name} className="text-[11px] leading-relaxed">
                <code className="font-mono text-txt">{tool.name}</code>
                <span className="text-muted"> — {tool.description}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {status && (
        <Panel className="p-4">
          <div className="flex items-center gap-2">
            <Bot size={14} className="shrink-0 text-muted" />
            <p className="text-[12px] font-medium text-txt">Client setup</p>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            {tokenHandlingNote(status.discovery_path)}
          </p>
          <div className="mt-3 flex flex-col gap-4">
            {snippets.map((snippet) => (
              <div key={snippet.id}>
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-medium text-txt">{snippet.label}</p>
                  <code className="font-mono text-[10px] text-muted">{snippet.filename}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Copy}
                    className="ml-auto shrink-0"
                    aria-label={`Copy ${snippet.label} snippet`}
                    disabled={!enabled}
                    onClick={() =>
                      copyText(snippet.code, `${snippet.label} snippet copied to clipboard`)
                    }
                  >
                    Copy
                  </Button>
                </div>
                <pre className="mt-1.5 overflow-x-auto rounded-md border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">
                  {snippet.code}
                </pre>
                <p className="mt-1.5 break-words text-[11px] leading-relaxed text-muted">
                  {snippet.note}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
