import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, CircleDot, MonitorSmartphone, Plus, Settings, Square, Play } from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import type { AvdInfo } from "../../store/types";
import { isFailed } from "../requests/filters";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { useTraffic } from "../../store/traffic";

export function CommandBar() {
  const captureOn = useTraffic((s) => s.captureOn);
  const capturePort = useTraffic((s) => s.capturePort);
  const exchanges = useTraffic((s) => s.exchanges);
  const order = useTraffic((s) => s.order);
  const targetSerial = useTraffic((s) => s.targetSerial);
  const targetAvd = useTraffic((s) => s.targetAvd);
  const setTarget = useTraffic((s) => s.setTarget);
  const setActiveView = useTraffic((s) => s.setActiveView);
  const setCapture = useTraffic((s) => s.setCapture);
  const setSettingsOpen = useTraffic((s) => s.setSettingsOpen);
  const setOnboarding = useTraffic((s) => s.setOnboarding);

  const [avds, setAvds] = useState<AvdInfo[]>([]);
  const [adbError, setAdbError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const failures = useMemo(
    () => order.filter((id) => { const ex = exchanges.get(id); return ex ? isFailed(ex) : false; }).length,
    [order, exchanges],
  );

  async function loadAvds() {
    try {
      const list = await invoke<AvdInfo[]>("list_avds");
      setAvds(list);
      setAdbError(null);
    } catch (e) {
      setAdbError(String(e));
    }
  }

  useEffect(() => {
    loadAvds();
    if (isTauri) {
      invoke("clear_stale_proxies").catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadAvds();
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const running = avds.filter((a) => a.running);
  const stopped = avds.filter((a) => !a.running);

  async function selectAvd(avd: AvdInfo) {
    setOpen(false);
    setTarget(avd.running ? avd.serial : null, avd.name);
    if (!avd.running) {
      try {
        await invoke("launch_avd", { name: avd.name });
        setOnboarding({ avdName: avd.name, createdNew: false });
      } catch (e) {
        setError(String(e));
      }
    }
  }

  async function toggleCapture() {
    setBusy(true);
    setError(null);
    try {
      if (captureOn) {
        await invoke("capture_stop");
        setCapture(false);
      } else if (targetSerial) {
        const capMb = Number(localStorage.getItem("beholder.bodyCapMb")) || 2;
        const port = await invoke<number>("capture_start", {
          serial: targetSerial,
          bodyCap: Math.round(capMb * 1024 * 1024),
        });
        setCapture(true, port);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const label = targetAvd ?? targetSerial ?? "select target";

  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            "h-2.5 w-2.5 rounded-full",
            captureOn ? "animate-pulse bg-ok" : "bg-muted/50",
          )}
        />
        <span className="text-[13px] font-semibold tracking-tight text-txt">Beholder</span>
      </div>

      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex h-8 items-center gap-2 rounded-md border border-line bg-bg px-2.5 text-[12px] text-txt hover:border-muted/50"
        >
          <MonitorSmartphone size={13} className="text-muted" />
          <span className="max-w-52 truncate font-mono">{label}</span>
          <ChevronDown size={13} className="text-muted" />
        </button>
        {open && (
          <div className="absolute left-0 top-10 w-80 rounded-lg border border-line bg-surface-2 p-1.5 shadow-xl">
            {adbError && (
              <p className="px-2 py-2 text-[11px] leading-relaxed text-danger">
                {adbError}
              </p>
            )}
            {!adbError && avds.length === 0 && (
              <p className="px-2 py-2 text-[11px] text-muted">
                No emulators found — create one below.
              </p>
            )}
            {running.length > 0 && (
              <p className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wider text-muted/70">running</p>
            )}
            {running.map((a) => (
              <TargetRow key={a.name} avd={a} onSelect={() => selectAvd(a)} active={targetAvd === a.name} />
            ))}
            {stopped.length > 0 && (
              <p className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wider text-muted/70">stopped</p>
            )}
            {stopped.map((a) => (
              <TargetRow key={a.name} avd={a} onSelect={() => selectAvd(a)} active={targetAvd === a.name} />
            ))}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setActiveView("emulators");
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-line px-2.5 py-2 text-[12px] text-muted hover:border-accent hover:text-accent"
            >
              <Plus size={13} /> Create emulator
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={busy || (!captureOn && !targetSerial)}
        onClick={toggleCapture}
        title={captureOn ? "Stop capture" : targetSerial ? "Start capture" : "Select a running emulator first"}
        className={clsx(
          "flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold transition-colors",
          captureOn
            ? "bg-danger/15 text-danger hover:bg-danger/25"
            : "bg-accent text-accent-fg disabled:opacity-40",
        )}
      >
        {captureOn ? <Square size={12} /> : <Play size={12} />}
        {captureOn ? "Stop" : "Capture"}
      </button>

      {error && <ErrorBox message={error} compact className="max-w-80" />}

      <div className="flex-1" />

      <div className="flex items-center gap-3 font-mono text-[11px] text-muted">
        {captureOn && capturePort != null && <span className="text-accent">:{capturePort}</span>}
        <span>{order.length} req</span>
        {failures > 0 && <span className="text-danger">{failures} fail</span>}
      </div>

      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        title="Settings"
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-bg hover:text-txt"
      >
        <Settings size={15} />
      </button>
    </header>
  );
}

function TargetRow({ avd, onSelect, active }: { avd: AvdInfo; onSelect: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-surface",
        active && "bg-surface",
      )}
    >
      {avd.running ? <CircleDot size={12} className="shrink-0 text-ok" /> : <span className="h-3 w-3 shrink-0" />}
      <span className="min-w-0 flex-1 truncate font-mono text-txt/90">{avd.name}</span>
      <span className="shrink-0 text-[10px] text-muted/70">
        {avd.running ? `API ${avd.api_level ?? "?"}` : avd.beholder_ready ? `API ${avd.api_level ?? "?"}` : "no root"}
      </span>
      {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
    </button>
  );
}
