import { useState } from "react";
import clsx from "clsx";
import { FileCode2, RotateCcw } from "lucide-react";
import { ACCENTS, ACCENT_SWATCHES, THEMES, THEME_LABELS } from "../../lib/theme/themes";
import { loadSlowMs, saveSlowMs } from "../../lib/prefs";
import { DEFAULT_CONFIG, type ColorOverrides, type UiConfig } from "../../lib/theme/config-types";
import { applyUiConfig } from "../../lib/theme/applyConfig";
import { invoke, isTauri } from "../../lib/tauri";
import { useTraffic } from "../../store/traffic";
import { Panel } from "../../components/ui/primitives";

const COLOR_LABELS: { key: keyof ColorOverrides; label: string }[] = [
  { key: "bg", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "surface_2", label: "Surface 2" },
  { key: "line", label: "Border" },
  { key: "text", label: "Text" },
  { key: "muted", label: "Muted text" },
  { key: "accent", label: "Accent" },
  { key: "ok", label: "Success" },
  { key: "warn", label: "Warning" },
  { key: "danger", label: "Danger" },
];

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted">
        {label} <span className="text-muted/60">({suffix})</span>
      </span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 w-32 accent-[var(--accent)]"
        />
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-7 w-16 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-txt focus:border-accent focus:outline-none"
        />
      </div>
    </div>
  );
}

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
        <p className="text-[12px] font-medium text-txt">Customize</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Everything lives in <code className="font-mono">config.toml</code> — edit it here or by hand,
          changes apply live.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <NumberField
            label="UI text"
            suffix="px"
            value={config.ui_font_size}
            min={11}
            max={16}
            onChange={(v) => save({ ...config, ui_font_size: v })}
          />
          <NumberField
            label="Mono text"
            suffix="px"
            value={config.mono_font_size}
            min={10}
            max={15}
            onChange={(v) => save({ ...config, mono_font_size: v })}
          />
          <NumberField
            label="Row height"
            suffix="px"
            value={config.row_height}
            min={28}
            max={44}
            onChange={(v) => save({ ...config, row_height: v })}
          />
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">Mono font family</span>
            <input
              value={config.mono_font_family ?? ""}
              placeholder="JetBrains Mono"
              onChange={(e) => save({ ...config, mono_font_family: e.target.value })}
              className="h-7 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-txt placeholder:text-muted/50 focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      </Panel>

      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Theme</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
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
                "h-6 w-6 rounded-full border-2 transition-colors",
                config.accent === a ? "border-txt" : "border-transparent hover:border-line",
              )}
              title={a}
            >
              <span className="block h-4 w-4 rounded-full" style={{ background: ACCENT_SWATCHES[a] }} />
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium text-txt">Colors</p>
          <button
            type="button"
            onClick={() => save({ ...config, colors: {} })}
            className="flex items-center gap-1 text-[11px] text-muted hover:text-txt"
          >
            <RotateCcw size={11} /> Reset overrides
          </button>
        </div>
        <p className="mt-1 text-[11px] text-muted">Empty = use theme value. Overrides beat the theme.</p>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">
          {COLOR_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted">{label}</span>
              <input
                type="color"
                value={config.colors?.[key] ?? "#000000"}
                onChange={(e) =>
                  save({ ...config, colors: { ...config.colors, [key]: e.target.value } as ColorOverrides })
                }
                className="h-6 w-10 cursor-pointer rounded border border-line bg-transparent"
              />
            </label>
          ))}
        </div>
      </Panel>

      <Panel className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] font-medium text-txt">config.toml</p>
            <p className="mt-1 text-[11px] text-muted">Ghostty-style: plain text, git-friendly, live reload.</p>
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
        <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">{`theme = "${config.theme}"
accent = "${config.accent}"
ui-font-size = ${config.ui_font_size}
mono-font-size = ${config.mono_font_size}
row-height = ${config.row_height}

[colors]
${COLOR_LABELS.filter(({ key }) => config.colors?.[key]).map(({ key }) => `${key.replace("_", "-")} = "${config.colors?.[key]}"`).join("\n") || "# accent = \"#22d3ee\""}`}</pre>
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

      <DeviceMaintenance />
    </div>
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
