import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, CircleDot, Play, Plus, RotateCcw } from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import { qError } from "../../lib/query";
import { loadBodyCapMb } from "../../lib/prefs";
import { useAdbDevicesQuery } from "../../queries/devices";
import { useAvdsQuery, useInvalidateEmulators } from "../../queries/emulators";
import { useCaptureHealthQuery, type CaptureCheckT } from "../../queries/captureHealth";
import type { AvdInfo } from "../../store/types";
import { useTraffic } from "../../store/traffic";
import { usePalette } from "../palette/store";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { Button } from "../../components/ui/Button";
import { Menu, type MenuOption } from "../../components/ui/Menu";
import { formatElapsed, healthSummary, type HealthTone } from "./captureStatus";

const MACOS_WINDOW_CONTROLS_INSET = 76;

function macOSWindowControlsInset(): number {
  if (!isTauri || typeof document === "undefined") return 0;
  return document.documentElement.dataset.platform === "macos"
    ? MACOS_WINDOW_CONTROLS_INSET
    : 0;
}

const HEALTH_TONE_CLS: Record<HealthTone, string> = {
  muted: "text-muted hover:text-txt",
  warn: "text-warn",
  danger: "text-danger",
};

export function CommandBar() {
  const captureOn = useTraffic((s) => s.captureOn);
  const capturePort = useTraffic((s) => s.capturePort);
  const metro = useTraffic((s) => s.metro);
  const targetSerial = useTraffic((s) => s.targetSerial);
  const targetAvd = useTraffic((s) => s.targetAvd);
  const setTarget = useTraffic((s) => s.setTarget);
  const setActiveView = useTraffic((s) => s.setActiveView);
  const setCapture = useTraffic((s) => s.setCapture);
  const setOnboarding = useTraffic((s) => s.setOnboarding);

  const avdsQ = useAvdsQuery();
  const adbQ = useAdbDevicesQuery();
  const healthQ = useCaptureHealthQuery(captureOn);
  const checks = healthQ.data ?? [];
  const refreshAvds = useInvalidateEmulators();
  const avds = avdsQ.data ?? [];
  const adbError = qError(adbQ.error) ?? qError(avdsQ.error);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshAvds();
    if (isTauri) {
      invoke("clear_stale_proxies").catch(() => {});
    }
  }, [refreshAvds]);

  const running = avds.filter((a) => a.running);
  const stopped = avds.filter((a) => !a.running);

  async function selectAvd(avd: AvdInfo) {
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
        const capMb = loadBodyCapMb();
        const port = await invoke<number>("capture_start", {
          serial: targetSerial,
          bodyCap: Math.round(capMb * 1024 * 1024),
        });
        setCapture(true, port);
      }
    } catch (e) {
      setCapture(false);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function restartCapture() {
    if (!targetSerial) return;
    setBusy(true);
    setError(null);
    try {
      const capMb = loadBodyCapMb();
      const port = await invoke<number>("capture_restart", {
        serial: targetSerial,
        bodyCap: Math.round(capMb * 1024 * 1024),
      });
      setCapture(true, port);
      useTraffic.getState().clear();
    } catch (e) {
      setCapture(false);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const label = targetAvd ?? targetSerial ?? "Select target";

  function targetMeta(a: AvdInfo): string {
    return a.running || a.beholder_ready ? `API ${a.api_level ?? "?"}` : "no root";
  }

  function avdItem(a: AvdInfo): MenuOption {
    const active = targetAvd === a.name;
    return {
      key: `${a.running ? "run" : "stop"}-${a.name}`,
      label: `${a.name} · ${targetMeta(a)}${active ? " · active" : ""}`,
      icon: active ? Check : a.running ? CircleDot : undefined,
      onSelect: () => void selectAvd(a),
    };
  }

  const targetItems: MenuOption[] = [];
  if (adbError) {
    targetItems.push({ key: "adb-error", label: adbError, danger: true, disabled: true, onSelect: () => {} });
  } else if (avds.length === 0) {
    targetItems.push({
      key: "no-avds",
      label: "No emulators found — create one below.",
      disabled: true,
      onSelect: () => {},
    });
  } else {
    if (running.length > 0) {
      targetItems.push({ key: "hdr-running", label: "running", disabled: true, onSelect: () => {} });
    }
    running.forEach((a) => targetItems.push(avdItem(a)));
    if (stopped.length > 0) {
      targetItems.push({ key: "hdr-stopped", label: "stopped", disabled: true, onSelect: () => {} });
    }
    stopped.forEach((a) => targetItems.push(avdItem(a)));
  }
  targetItems.push({
    key: "create-emulator",
    label: "Create emulator",
    icon: Plus,
    onSelect: () => setActiveView("emulators"),
  });

  const summary = healthSummary({
    checks,
    unknown: healthQ.isPending || healthQ.isError,
    capturePort,
    metro,
  });

  return (
    <header
      data-tauri-drag-region
      style={{ paddingLeft: macOSWindowControlsInset() }}
      className="app-toolbar relative z-30 h-[46px] shrink-0"
    >
      <div data-tauri-drag-region className="flex h-full flex-nowrap items-center gap-2.5 overflow-hidden px-3">
        <Menu
          items={targetItems}
          onClose={() => {}}
          width={320}
          trigger={(t) => (
            <button
              ref={t.ref}
              type="button"
              className="press focus-ring flex h-7 min-w-0 shrink-0 items-center gap-2 rounded-[8px] px-2.5 text-[13px] font-semibold text-txt hover:bg-surface-2"
              onClick={() => {
                void refreshAvds();
                t.onClick();
              }}
              aria-haspopup="menu"
              aria-expanded={t["aria-expanded"]}
              title="Select emulator target"
            >
              <span
                aria-hidden="true"
                className={clsx(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  targetSerial ? "bg-accent" : "bg-muted/50",
                )}
              />
              <span className="min-w-0 max-w-48 truncate">{label}</span>
              <ChevronDown size={13} className="shrink-0 text-muted" />
            </button>
          )}
        />

        {captureOn ? (
          <CapturePill busy={busy} onStop={toggleCapture} />
        ) : (
          <Button
            variant="primary"
            size="sm"
            icon={Play}
            disabled={busy || !targetSerial}
            onClick={toggleCapture}
            className="shrink-0 whitespace-nowrap"
            title={targetSerial ? "Start capture" : "Select a running emulator first"}
          >
            Capture
          </Button>
        )}

        {captureOn && (
          <CaptureDoctor
            summary={summary.text}
            toneCls={HEALTH_TONE_CLS[summary.tone]}
            checks={checks}
            busy={busy}
            hasTarget={targetSerial != null}
            onRestart={restartCapture}
          />
        )}

        <div data-tauri-drag-region className="h-full min-w-4 flex-1" />

        <button
          type="button"
          onClick={() => usePalette.getState().toggle()}
          aria-keyshortcuts="Meta+K Control+K"
          className="press focus-ring flex h-7 w-60 min-w-0 shrink items-center justify-between gap-6 rounded-[8px] bg-surface pl-3 pr-1.5 text-[12px] text-muted shadow-[inset_0_0_0_1px_var(--line)] hover:text-txt"
        >
          <span className="truncate">Search or run a command</span>
          <kbd className="shrink-0 rounded-[4px] bg-surface-2 px-1.5 py-px font-mono text-[11px] leading-4 text-muted">
            ⌘K
          </kbd>
        </button>
      </div>

      {error && (
        <div className="anim-pop-in absolute right-2 top-full z-40 w-80 max-w-[calc(100vw-1rem)]">
          <ErrorBox message={error} />
        </div>
      )}
    </header>
  );
}

function CapturePill({ busy, onStop }: { busy: boolean; onStop: () => void }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div
      role="status"
      aria-label="Capture running"
      className="flex h-7 shrink-0 items-center gap-2 rounded-full bg-accent/13 pl-3 pr-1 text-[12px] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_22%,transparent)]"
    >
      <span aria-hidden="true" className="live-pulse h-[7px] w-[7px] rounded-full bg-accent" />
      <span className="font-semibold text-accent">Capturing</span>
      <span className="font-mono tabular-nums text-txt">{formatElapsed(now - start)}</span>
      <button
        type="button"
        onClick={onStop}
        disabled={busy}
        aria-label="Stop capture"
        title="Stop capture"
        className="press focus-ring grid h-5 w-5 place-items-center rounded-full hover:bg-danger/25 disabled:pointer-events-none disabled:opacity-40"
      >
        <span className="h-2 w-2 rounded-[2px] bg-txt" />
      </button>
    </div>
  );
}

function checkTextCls(status: CaptureCheckT["status"]): string {
  if (status === "fail") return "text-danger";
  if (status === "warn") return "text-warn";
  return "text-ok";
}

function CaptureDoctor({
  summary,
  toneCls,
  checks,
  busy,
  hasTarget,
  onRestart,
}: {
  summary: string;
  toneCls: string;
  checks: CaptureCheckT[];
  busy: boolean;
  hasTarget: boolean;
  onRestart: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative hidden min-w-0 items-center md:flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Capture doctor"
        aria-expanded={open}
        className={clsx(
          "focus-ring min-w-0 truncate rounded-[6px] px-1.5 py-1 text-[12px] transition-colors",
          toneCls,
        )}
      >
        {summary}
      </button>
      {open && (
        <div className="anim-pop-in fixed top-[42px] z-40 w-80 rounded-[10px] bg-surface-2 p-1.5 shadow-[var(--shadow-3),inset_0_0_0_1px_var(--line)]">
          <p className="px-2 pb-1 pt-1.5 text-[12px] font-semibold text-txt">Capture doctor</p>
          {checks.length === 0 && (
            <p className="px-2 py-1.5 text-[11px] text-muted">checking capture health...</p>
          )}
          {checks.map((c) => (
            <p key={c.id} className={clsx("px-2 py-1 text-[11px] leading-relaxed", checkTextCls(c.status))}>
              {c.title} — {c.detail}
            </p>
          ))}
          <Button
            variant="danger"
            icon={RotateCcw}
            className="mt-1 w-full"
            disabled={busy || !hasTarget}
            title={hasTarget ? "Restart capture" : "Select a target first"}
            onClick={() => {
              setOpen(false);
              onRestart();
            }}
          >
            Restart capture
          </Button>
        </div>
      )}
    </div>
  );
}
