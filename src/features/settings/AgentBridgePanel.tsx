import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import clsx from "clsx";
import { Bot, CircleSlash, Copy, Zap } from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import { toast } from "../../components/ui/toast";
import { Panel } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { Toggle } from "../../components/ui/Toggle";
import {
  bridgeDetailsLine,
  connectionsLine,
  isAgentClientActive,
  type AgentBridgeStatus,
  type AgentConnections,
} from "./agentBridge";
import { buildMcpSnippets, tokenHandlingNote } from "./agentSnippets";
import { JsonCode } from "./JsonCode";
import {
  lastSnippetTab,
  nextSnippetTab,
  rememberSnippetTab,
  type SnippetTabId,
} from "./snippetTabs";

const TAB_NAV_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

export function AgentBridgePanel() {
  const [status, setStatus] = useState<AgentBridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState<SnippetTabId>(
    () => lastSnippetTab() ?? "generic",
  );
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

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

  useEffect(() => {
    rememberSnippetTab(activeTab);
  }, [activeTab]);

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

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!TAB_NAV_KEYS.has(e.key)) return;
    e.preventDefault();
    const next = nextSnippetTab(activeTab, e.key);
    setActiveTab(next);
    tabRefs.current[next]?.focus();
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
  const activeSnippet = snippets.find((s) => s.id === activeTab) ?? snippets[0] ?? null;

  return (
    <>
      <Panel className="p-4">
        <div className="flex items-start justify-between gap-3">
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
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
                  enabled
                    ? "border-ok/30 bg-ok/10 text-ok"
                    : "border-line bg-surface-2 text-muted",
                )}
              >
                {enabled ? <Zap size={11} /> : <CircleSlash size={11} />}
                {enabled ? "Active" : "Disabled"}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={clsx(
                    "h-2 w-2 shrink-0 rounded-full",
                    active ? "animate-pulse bg-ok" : "bg-muted/50",
                  )}
                />
                <span className={clsx("truncate text-[11px]", active ? "text-ok" : "text-muted")}>
                  {connectionsLine(status.connections, now)}
                </span>
              </span>
              <span className="text-[11px] text-muted">
                {status.tools.length} {status.tools.length === 1 ? "tool" : "tools"}
              </span>
            </div>
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
              {bridgeDetailsLine(status)}
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
          <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
            {status.tools.map((tool) => (
              <li
                key={tool.name}
                className="flex items-start gap-3 rounded-md border border-line/60 bg-surface-2/50 px-2.5 py-1.5"
              >
                <code className="min-w-0 shrink-0 break-all font-mono text-[11px] text-txt">
                  {tool.name}
                </code>
                <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted">
                  {tool.description}
                </span>
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
          <div
            role="tablist"
            aria-label="Client formats"
            className="mt-3 flex flex-wrap gap-1 border-b border-line"
          >
            {snippets.map((snippet) => {
              const selected = snippet.id === activeSnippet?.id;
              return (
                <button
                  key={snippet.id}
                  ref={(el) => {
                    tabRefs.current[snippet.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`snippet-tab-${snippet.id}`}
                  aria-selected={selected}
                  aria-controls="snippet-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveTab(snippet.id as SnippetTabId)}
                  onKeyDown={onTabKeyDown}
                  className={clsx(
                    "press focus-ring -mb-px rounded-t-md border border-b-0 px-2.5 py-1.5 text-[11px] font-medium",
                    selected
                      ? "border-line bg-bg text-txt"
                      : "border-transparent text-muted hover:text-txt",
                  )}
                >
                  {snippet.label}
                </button>
              );
            })}
          </div>
          {activeSnippet && (
            <div
              role="tabpanel"
              id="snippet-panel"
              aria-labelledby={`snippet-tab-${activeSnippet.id}`}
              tabIndex={0}
              className="focus-ring rounded-b-md"
            >
              <div className="mt-2.5 flex items-center gap-2">
                <code className="font-mono text-[10px] text-muted">
                  {activeSnippet.filename}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Copy}
                  className="ml-auto shrink-0"
                  aria-label={`Copy ${activeSnippet.label} snippet`}
                  disabled={!enabled}
                  onClick={() =>
                    copyText(activeSnippet.code, `${activeSnippet.label} snippet copied to clipboard`)
                  }
                >
                  Copy
                </Button>
              </div>
              <JsonCode code={activeSnippet.code} className="mt-1.5" />
              <p className="mt-1.5 break-words text-[11px] leading-relaxed text-muted">
                {activeSnippet.note}
              </p>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
