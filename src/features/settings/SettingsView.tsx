import { useState } from "react";
import clsx from "clsx";
import { ACCENTS, ACCENT_SWATCHES, applyTheme, loadTheme, THEMES, THEME_LABELS, type AccentName, type ThemeName } from "../../lib/theme/themes";
import { loadSlowMs, saveSlowMs } from "../../lib/prefs";
import { Panel } from "../../components/ui/primitives";

export function SettingsView() {
  const initial = loadTheme();
  const [theme, setTheme] = useState<ThemeName>(initial.theme);
  const [accent, setAccent] = useState<AccentName>(initial.accent);
  const [bodyCapMb, setBodyCapMb] = useState<number>(
    () => Number(localStorage.getItem("beholder.bodyCapMb")) || 2,
  );
  const [slowMs, setSlowMs] = useState<number>(loadSlowMs);

  function changeTheme(t: ThemeName) {
    setTheme(t);
    applyTheme(t, accent);
  }

  function changeAccent(a: AccentName) {
    setAccent(a);
    applyTheme(theme, a);
  }

  function changeCap(mb: number) {
    if (Number.isNaN(mb) || mb < 0) return;
    setBodyCapMb(mb);
    localStorage.setItem("beholder.bodyCapMb", String(mb));
  }

  function changeSlow(ms: number) {
    if (Number.isNaN(ms) || ms < 50) return;
    setSlowMs(ms);
    saveSlowMs(ms);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-sm font-semibold text-txt">Settings</h1>

      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Theme</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => changeTheme(t)}
              className={clsx(
                "rounded-md border p-3 text-left transition-colors",
                theme === t ? "border-accent" : "border-line hover:border-muted/40",
              )}
              data-theme={t}
            >
              <div className="mb-2 flex gap-1 rounded border border-line" style={{ background: "var(--bg)" }}>
                <div className="h-8 flex-1" style={{ background: "var(--surface)" }} />
                <div className="h-8 w-4" style={{ background: "var(--accent)" }} />
              </div>
              <span className="text-[12px] text-txt">{THEME_LABELS[t]}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Accent</p>
        <div className="mt-3 flex gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => changeAccent(a)}
              className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
                accent === a ? "border-txt" : "border-transparent hover:border-line",
              )}
              title={a}
            >
              <span className="h-5 w-5 rounded-full" style={{ background: ACCENT_SWATCHES[a] }} />
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Body capture limit</p>
        <p className="mt-1 text-[11px] text-muted">
          Bodies larger than this are truncated in the inspector (traffic is never blocked). Applied on next capture
          start.
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
    </div>
  );
}
