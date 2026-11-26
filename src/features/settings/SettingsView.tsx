import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import clsx from "clsx";
import {
  Bot,
  Copy,
  FileCode2,
  Info,
  MonitorSmartphone,
  Palette,
  RefreshCw,
  SquareTerminal,
} from "lucide-react";
import {
  ACCENTS,
  ACCENT_SWATCHES,
  customAccentSeed,
  persistThemeChoice,
  THEME_MODES,
  THEME_MODE_LABELS,
  type AccentName,
} from "../../lib/theme/themes";
import { loadBodyCapMb, loadSlowMs, saveBodyCapMb, saveSlowMs } from "../../lib/prefs";
import { DEFAULT_CONFIG, type UiConfig } from "../../lib/theme/config-types";
import { applyUiConfig } from "../../lib/theme/applyConfig";
import { invoke, isTauri } from "../../lib/tauri";
import { useTraffic } from "../../store/traffic";
import { toast } from "../../components/ui/toast";
import { Panel } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Toggle } from "../../components/ui/Toggle";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import {
  DEFAULT_CONSOLE_CONFIG,
  resolveConfigPath,
  withConsolePatch,
  withCustomAccent,
  withNamedAccent,
  withTheme,
} from "./configControls";
import { AgentBridgePanel } from "./AgentBridgePanel";
import {
  lastActiveSection,
  nextSectionId,
  rememberActiveSection,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "./sections";
import { useUpdater } from "../updater/useUpdater";

const SECTION_ICONS: Record<SettingsSectionId, typeof Palette> = {
  appearance: Palette,
  "agent-bridge": Bot,
  console: SquareTerminal,
  devices: MonitorSmartphone,
  about: Info,
};

const BUFFER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "main", label: "Main" },
  { value: "system", label: "System" },
  { value: "crash", label: "Crash" },
];

const TAB_NAV_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

export function SettingsView() {
  const [active, setActive] = useState<SettingsSectionId>(
    () => lastActiveSection() ?? "appearance",
  );

  useEffect(() => {
    rememberActiveSection(active);
  }, [active]);

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function selectSection(id: SettingsSectionId) {
    setActive(id);
  }

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!TAB_NAV_KEYS.has(e.key)) return;
    e.preventDefault();
    const next = nextSectionId(active, e.key);
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      <h1 className="sr-only">Settings</h1>
      <nav
        role="tablist"
        aria-orientation="vertical"
        aria-label="Settings sections"
        className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface p-2"
      >
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = SECTION_ICONS[section.id];
          const selected = section.id === active;
          return (
            <button
              key={section.id}
              ref={(el) => {
                tabRefs.current[section.id] = el;
              }}
              type="button"
              role="tab"
              id={`settings-tab-${section.id}`}
              aria-selected={selected}
              aria-controls={`settings-panel-${section.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectSection(section.id)}
              onKeyDown={onTabKeyDown}
              className={clsx(
                "press focus-ring relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium",
                selected ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface-2 hover:text-txt",
              )}
            >
              {selected && (
                <span className="absolute left-0.5 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-accent" />
              )}
              <Icon size={16} className="shrink-0" />
              <span>{section.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div
          role="tabpanel"
          id={`settings-panel-${active}`}
          aria-labelledby={`settings-tab-${active}`}
          tabIndex={0}
          className="focus-ring mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-md px-4 py-4"
        >
          {active === "appearance" && <AppearanceSection />}
          {active === "agent-bridge" && <AgentBridgePanel />}
          {active === "console" && <ConsoleSection />}
          {active === "devices" && <DeviceMaintenance />}
          {active === "about" && <UpdatesPanel />}
        </div>
      </div>
    </div>
  );
}

function useSaveConfig() {
  const uiConfig = useTraffic((s) => s.uiConfig);
  const config: UiConfig = uiConfig ?? DEFAULT_CONFIG;

  async function save(next: UiConfig) {
    useTraffic.getState().setUiConfig(next);
    applyUiConfig(next);
    if (isTauri) {
      await invoke("set_config", { config: next }).catch(() => {});
    } else {
      persistThemeChoice(next.theme, next.accent);
    }
  }

  return { config, save };
}

function AppearanceSection() {
  const { config, save } = useSaveConfig();
  const [slowMs, setSlowMs] = useState<number>(loadSlowMs);
  const [bodyCapMb, setBodyCapMb] = useState<number>(loadBodyCapMb);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const commitTimer = useRef<number | null>(null);

  const customAccentActive = Boolean(config.colors?.accent?.trim());
  const [customAccent, setCustomAccent] = useState<string>(() => customAccentSeed(config));

  useEffect(() => {
    setCustomAccent(customAccentSeed(config));
  }, [config.colors?.accent, config.accent]);

  useEffect(() => {
    resolveConfigPath().then(setConfigPath);
  }, []);

  useEffect(() => {
    return () => {
      if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
    };
  }, []);

  function changeSlow(ms: number) {
    if (Number.isNaN(ms) || ms < 50) return;
    setSlowMs(ms);
    saveSlowMs(ms);
  }

  function changeCap(mb: number) {
    if (Number.isNaN(mb) || mb < 0) return;
    setBodyCapMb(mb);
    saveBodyCapMb(mb);
  }

  function chooseNamedAccent(accent: AccentName) {
    void save(withNamedAccent(config, accent));
  }

  function changeCustomAccent(hex: string) {
    setCustomAccent(hex);
    const next = withCustomAccent(config, hex);
    useTraffic.getState().setUiConfig(next);
    applyUiConfig(next);
    if (!isTauri) return;
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      invoke("set_accent_color", { color: hex }).catch(() => {});
    }, 250);
  }

  function copyConfigPath() {
    if (!configPath) return;
    navigator.clipboard.writeText(configPath).then(
      () => toast("Config path copied to clipboard"),
      () => toast("Clipboard unavailable", "danger"),
    );
  }

  return (
    <>
      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Theme</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {THEME_MODES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => void save(withTheme(config, t))}
              aria-pressed={config.theme === t}
              className={clsx(
                "press focus-ring rounded-md border p-2.5 text-left transition-colors",
                config.theme === t ? "border-accent" : "border-line hover:border-muted/40",
              )}
              data-theme={t === "system" ? undefined : t}
            >
              {t === "system" ? (
                <div
                  className="mb-1.5 flex gap-1 rounded border border-line"
                  style={{ background: "var(--bg)" }}
                >
                  <div data-theme="paper" className="h-6 flex-1" style={{ background: "var(--surface)" }} />
                  <div data-theme="obsidian" className="h-6 flex-1" style={{ background: "var(--surface)" }} />
                  <div className="h-6 w-3" style={{ background: "var(--accent)" }} />
                </div>
              ) : (
                <div className="mb-1.5 flex gap-1 rounded border border-line" style={{ background: "var(--bg)" }}>
                  <div className="h-6 flex-1" style={{ background: "var(--surface)" }} />
                  <div className="h-6 w-3" style={{ background: "var(--accent)" }} />
                </div>
              )}
              <span className="text-[11px] text-txt">{THEME_MODE_LABELS[t]}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-muted">Accent</span>
          {ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => chooseNamedAccent(a)}
              aria-label={`${a} accent`}
              aria-pressed={!customAccentActive && config.accent === a}
              className={clsx(
                "press focus-ring flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors",
                !customAccentActive && config.accent === a
                  ? "border-txt"
                  : "border-transparent hover:border-line",
              )}
              title={a}
            >
              <span className="block h-3.5 w-3.5 rounded-full" style={{ background: ACCENT_SWATCHES[a] }} />
            </button>
          ))}
          <span className="h-5 w-px bg-line" aria-hidden="true" />
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              aria-label="Custom accent color"
              title="Custom accent color"
              value={customAccent}
              onChange={(e) => changeCustomAccent(e.target.value)}
              className={clsx(
                "focus-ring h-6 w-6 shrink-0 cursor-pointer rounded-full border-2 bg-transparent p-0 transition-colors",
                "[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none",
                customAccentActive ? "border-txt" : "border-transparent hover:border-line",
              )}
            />
            {customAccentActive && <span className="text-[11px] text-muted">Custom</span>}
          </div>
        </div>
      </Panel>

      <Panel className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium text-txt">config.toml</p>
            <p className="mt-1 text-[11px] text-muted">
              Ghostty-style: plain text, git-friendly, live reload. Edit it directly.
            </p>
          </div>
          {isTauri && (
            <Button
              variant="ghost"
              size="sm"
              icon={FileCode2}
              onClick={() => invoke("reveal_config").catch(() => {})}
            >
              Reveal
            </Button>
          )}
        </div>
        {configPath && (
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border border-line bg-bg px-2 py-1 font-mono text-[11px] text-muted">
              {configPath}
            </code>
            <Button
              variant="ghost"
              size="sm"
              icon={Copy}
              className="shrink-0"
              aria-label="Copy config path"
              onClick={copyConfigPath}
            >
              Copy
            </Button>
          </div>
        )}
        <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">{`theme = "paper"            # paper | contrast | obsidian | carbon | eclipse | system
accent = "lime"             # lime | cyan | amber | violet
ui_font_size = 13           # px, general UI text
mono_font_size = 12         # px, requests and payloads
row_height = 34             # px, request list rows
mono_font_family = ""       # e.g. "JetBrains Mono"

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
# danger = "#f44747"

[window]                    # optional overrides; unset fields follow the theme
# sidebar_opacity = 86      # 0-100, 100 = solid; delete section for theme look
# main_pane_glass = false   # also glaze the request panes
# blur_radius = 30          # 0-64, desktop blur behind the glaze`}</pre>
      </Panel>

      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Body capture limit</p>
        <p className="mt-1 text-[11px] text-muted">
          Bodies larger than this are truncated in the inspector (traffic is never blocked). Applied on
          next capture start.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <div className="w-24">
            <Input
              type="number"
              min={0}
              step={0.25}
              mono
              aria-label="Body capture limit in megabytes"
              value={bodyCapMb}
              onChange={(e) => changeCap(Number(e.target.value))}
            />
          </div>
          <span className="text-[12px] text-muted">MB</span>
        </div>
      </Panel>

      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Slow request threshold</p>
        <p className="mt-1 text-[11px] text-muted">
          Requests slower than this are highlighted in the list, the slow filter, and timing bars.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <div className="w-24">
            <Input
              type="number"
              min={50}
              step={50}
              mono
              aria-label="Slow request threshold in milliseconds"
              value={slowMs}
              onChange={(e) => changeSlow(Number(e.target.value))}
            />
          </div>
          <span className="text-[12px] text-muted">ms</span>
        </div>
      </Panel>
    </>
  );
}

function ConsoleSection() {
  const { config, save } = useSaveConfig();
  const consoleCfg = config.console ?? DEFAULT_CONSOLE_CONFIG;

  function changeRingLines(lines: number) {
    if (Number.isNaN(lines) || lines < 100) return;
    void save(withConsolePatch(config, { ring_lines: lines }));
  }

  return (
    <>
      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Ring buffer</p>
        <p className="mt-1 text-[11px] text-muted">
          Number of console lines kept while capturing. Older lines are dropped on device.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <div className="w-28">
            <Input
              type="number"
              min={100}
              step={1000}
              mono
              aria-label="Console ring buffer in lines"
              value={consoleCfg.ring_lines}
              onChange={(e) => changeRingLines(Number(e.target.value))}
            />
          </div>
          <span className="text-[12px] text-muted">lines</span>
        </div>
      </Panel>
      <Panel className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium text-txt">Thread IDs</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Show a TID column in the console log list.
            </p>
          </div>
          <Toggle
            checked={consoleCfg.show_tid}
            onChange={(v) => void save(withConsolePatch(config, { show_tid: v }))}
            label="Show thread IDs"
          />
        </div>
      </Panel>
      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Default buffer</p>
        <p className="mt-1 text-[11px] text-muted">
          Logcat buffer captured by default when the console view starts.
        </p>
        <div className="mt-3">
          <SegmentedControl
            options={BUFFER_OPTIONS}
            value={consoleCfg.default_buffer}
            onChange={(v) => void save(withConsolePatch(config, { default_buffer: v }))}
            ariaLabel="Default logcat buffer"
          />
        </div>
      </Panel>
    </>
  );
}

function UpdatesPanel() {
  const { status, checkForUpdates } = useUpdater();
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

  const checking = status.kind === "checking";
  const busy =
    checking || status.kind === "downloading" || status.kind === "installing";

  let result: string | null = null;
  if (status.kind === "uptodate") result = "Up to date.";
  else if (status.kind === "available") result = `Beholder ${status.version} available.`;
  else if (status.kind === "downloading") result = `Downloading… ${status.percent}%`;
  else if (status.kind === "installing") result = "Installing…";
  else if (status.kind === "error") result = status.message;

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-txt">Updates</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Signed builds are installed from GitHub Releases
            {appVersion ? ` — running ${appVersion}` : ""}.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled={!isTauri || busy}
          onClick={checkForUpdates}
        >
          <RefreshCw size={14} className={clsx("shrink-0", checking && "animate-spin")} /> Check for
          updates
        </Button>
      </div>
      {result && (
        <p
          className={clsx(
            "mt-2 break-words text-[11px]",
            status.kind === "error"
              ? "text-danger"
              : status.kind === "available"
                ? "text-accent"
                : "text-muted",
          )}
        >
          {result}
        </p>
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
      setMsg("Proxy reverted and CA removed from all connected devices.");
    } catch (e) {
      setCapture(false);
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
        <Button variant="ghost" size="sm" disabled={busy} onClick={revertProxy}>
          Revert proxy
        </Button>
        <Button variant="danger" size="sm" disabled={busy} onClick={fullCleanup}>
          Full cleanup
        </Button>
      </div>
      {msg && <p className="mt-2 break-words text-[11px] text-muted">{msg}</p>}
    </Panel>
  );
}
