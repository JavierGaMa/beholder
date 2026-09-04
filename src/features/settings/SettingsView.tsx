import { useEffect, useState } from "react";
import clsx from "clsx";
import { Copy, FileCode2 } from "lucide-react";
import { ACCENTS, ACCENT_SWATCHES, THEMES, THEME_LABELS } from "../../lib/theme/themes";
import { loadSlowMs, saveSlowMs } from "../../lib/prefs";
import { DEFAULT_CONFIG, type UiConfig } from "../../lib/theme/config-types";
import { applyUiConfig } from "../../lib/theme/applyConfig";
import { invoke, isTauri } from "../../lib/tauri";
import { useTraffic } from "../../store/traffic";
import { toast } from "../../components/ui/toast";
import { Panel } from "../../components/ui/primitives";
import {
  bridgeStatusLine,
  formatBridgeInfo,
  type AgentBridgeStatus,
} from "./agentBridge";

export function SettingsView() {
  const uiConfig = useTraffic((s) => s.uiConfig);
  const [slowMs, setSlowMs] = useState<number>(loadSlowMs);
  const [bodyCapMb, setBodyCapMb] = useState<number>(
    () => Number(localStorage.getItem("beholder.bodyCapMb")) || 2,
  );

  const config: UiConfig = uiConfig ?? DEFAULT_CONFIG;

  function changeSlow(ms: number) {
    if (Number.isNaN(ms) || ms < 50) return;
    setSlowMs(ms);
    saveSlowMs(ms);
  }

  function changeCap(mb: number) {
    if (Number.isNaN(mb) || mb < 0) return;
    setBodyCapMb(mb);
    localStorage.setItem("beholder.bodyCapMb", String(mb));
  }

  async function save(next: UiConfig) {
    useTraffic.getState().setUiConfig(next);
    applyUiConfig(next);
    if (isTauri) {
      await invoke("set_config", { config: next }).catch(() => {});
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-5">
      <h1 className="text-sm font-semibold text-txt">Settings</h1>

      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Theme</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => save({ ...config, theme: t })}
              className={clsx(
                "rounded-md border p-2.5 text-left transition-colors",
                config.theme === t ? "border-accent" : "border-line hover:border-muted/40",
              )}
              data-theme={t}
            >
              <div className="mb-1.5 flex gap-1 rounded border border-line" style={{ background: "var(--bg)" }}>
                <div className="h-6 flex-1" style={{ background: "var(--surface)" }} />
                <div className="h-6 w-3" style={{ background: "var(--accent)" }} />
              </div>
              <span className="text-[11px] text-txt">{THEME_LABELS[t]}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-[11px] text-muted">Accent</span>
          {ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => save({ ...config, accent: a })}
              className={clsx(
                "flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors",
                config.accent === a ? "border-txt" : "border-transparent hover:border-line",
              )}
              title={a}
            >
              <span className="block h-3.5 w-3.5 rounded-full" style={{ background: ACCENT_SWATCHES[a] }} />
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] font-medium text-txt">config.toml</p>
            <p className="mt-1 text-[11px] text-muted">
              Ghostty-style: plain text, git-friendly, live reload. Edit it directly.
            </p>
          </div>
          {isTauri && (
            <button
              type="button"
              onClick={() => invoke("reveal_config").catch(() => {})}
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-muted hover:text-accent"
            >
              <FileCode2 size={12} /> Reveal
            </button>
          )}
        </div>
        <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">{`theme = "contrast"          # contrast | obsidian | carbon | eclipse
accent = "lime"             # lime | cyan | amber | violet
ui-font-size = 13           # px, general UI text
mono-font-size = 12         # px, requests and payloads
row-height = 34             # px, request list rows
mono-font-family = ""       # e.g. "JetBrains Mono"

[colors]                    # optional overrides, empty = theme value
# bg = "#000000"
# surface = "#101010"
# surface-2 = "#171715"
# line = "#3b3b37"
# text = "#ffffff"
# muted = "#8b8a84"
# accent = "#c6fd00"
# ok = "#89d185"
# warn = "#ffcc00"
# danger = "#f44747"`}</pre>
      </Panel>

      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Body capture limit</p>
        <p className="mt-1 text-[11px] text-muted">
          Bodies larger than this are truncated in the inspector (traffic is never blocked). Applied on
          next capture start.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={bodyCapMb}
            onChange={(e) => changeCap(Number(e.target.value))}
            className="h-7 w-24 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-txt focus:border-accent focus:outline-none"
          />
          <span className="text-[12px] text-muted">MB</span>
        </div>
      </Panel>

      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Slow request threshold</p>
        <p className="mt-1 text-[11px] text-muted">
          Requests slower than this are highlighted in the list, the slow filter, and timing bars.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            min={50}
            step={50}
            value={slowMs}
            onChange={(e) => changeSlow(Number(e.target.value))}
            className="h-7 w-24 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-txt focus:border-accent focus:outline-none"
          />
          <span className="text-[12px] text-muted">ms</span>
        </div>
      </Panel>

      <AgentBridgePanel />
      <DeviceMaintenance />
    </div>
  );
}

function AgentBridgePanel() {
  const [status, setStatus] = useState<AgentBridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    invoke<AgentBridgeStatus>("agent_bridge_status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function refreshStatus() {
    const next = await invoke<AgentBridgeStatus>("agent_bridge_status");
    setStatus(next);
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

  async function copyMcpConfig() {
    try {
      const snippet = await invoke<string>("agent_mcp_config");
      navigator.clipboard.writeText(snippet).then(
        () => toast("MCP config copied to clipboard"),
        () => toast("Clipboard unavailable", "danger"),
      );
    } catch (e) {
      toast(String(e), "danger");
    }
  }

  const enabled = status?.enabled ?? false;

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-txt">Agent bridge</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Lets MCP agents query captured traffic and console logs over a local
            HTTP API.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Enable agent bridge"
          disabled={busy || !status}
          onClick={toggleEnabled}
          className={clsx(
            "relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-40",
            enabled ? "border-accent bg-accent/20" : "border-line bg-bg",
          )}
        >
          <span
            className={clsx(
              "absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full transition-all",
              enabled ? "left-[calc(100%-1rem)] bg-accent" : "left-1 bg-muted",
            )}
          />
        </button>
      </div>
      {status && (
        <>
          <p className={clsx("mt-2 text-[11px]", enabled ? "text-ok" : "text-muted")}>
            {bridgeStatusLine(status)}
          </p>
          <div className="mt-3">
            <button
              type="button"
              disabled={!enabled}
              onClick={copyMcpConfig}
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-muted hover:text-accent disabled:opacity-40"
            >
              <Copy size={12} /> Copy MCP config
            </button>
            <p className="mt-2 font-mono text-[11px] text-muted">
              {formatBridgeInfo(status)}
            </p>
          </div>
        </>
      )}
    </Panel>
  );
}

function DeviceMaintenance() {
  const setCapture = useTraffic((s) => s.setCapture);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function revertProxy() {
    setBusy(true);
    setMsg(null);
    try {
      await invoke("capture_stop");
      setCapture(false);
      setMsg("Proxy reverted on all emulators.");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fullCleanup() {
    setBusy(true);
    setMsg(null);
    try {
      await invoke("full_cleanup");
      setCapture(false);
      setMsg("Proxy reverted and CA removed from all emulators.");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-4">
      <p className="text-[12px] font-medium text-txt">Device maintenance</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        The proxy is reverted automatically on stop and quit. The CA stays installed for faster
        sessions — remove it with full cleanup.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={revertProxy}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-muted hover:text-txt disabled:opacity-40"
        >
          Revert proxy
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={fullCleanup}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-muted hover:text-danger disabled:opacity-40"
        >
          Full cleanup
        </button>
      </div>
      {msg && <p className="mt-2 break-words text-[11px] text-muted">{msg}</p>}
    </Panel>
  );
}
