import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  ChevronDown,
  CircleDot,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { invoke } from "../../lib/tauri";
import { useDevices } from "../../store/devices";
import {
  applyBootEvent,
  buildDeviceOptions,
  type BootState,
  type RunningDeviceOption,
  type StoppedAvdOption,
} from "./deviceOptions";

const RESOLVE_TIMEOUT_MS = 30_000;
const RESOLVE_INTERVAL_MS = 2_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function errorText(e: unknown): string {
  return String(e).replace(/^Error: /, "");
}

export function DevicePicker({
  serial,
  onSelect,
}: {
  serial: string;
  onSelect: (serial: string) => void;
}) {
  const devices = useDevices((s) => s.devices);
  const avds = useDevices((s) => s.avds);
  const status = useDevices((s) => s.status);
  const error = useDevices((s) => s.error);
  const refreshing = useDevices((s) => s.refreshing);
  const refresh = useDevices((s) => s.refresh);

  const [boot, setBoot] = useState<BootState>({ phase: "idle" });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const options = useMemo(() => buildDeviceOptions(devices, avds), [devices, avds]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open, refresh]);

  const running = options.filter((o): o is RunningDeviceOption => o.kind === "device");
  const stopped = options.filter((o): o is StoppedAvdOption => o.kind === "avd");
  const firstRunningId = running[0]?.id ?? "";
  const hasSelectedRunning = running.some((d) => d.id === serial);

  useEffect(() => {
    if (!firstRunningId || hasSelectedRunning) return;
    onSelect(firstRunningId);
  }, [firstRunningId, hasSelectedRunning, onSelect]);

  async function bootAvd(name: string) {
    if (boot.phase === "booting") return;
    setBoot((cur) => applyBootEvent(cur, { type: "start", avdName: name }));
    try {
      await invoke("launch_avd", { name });
      let resolved: string | null = null;
      const started = Date.now();
      while (Date.now() - started < RESOLVE_TIMEOUT_MS) {
        try {
          resolved = await invoke<string>("resolve_serial_for_avd", { name });
          break;
        } catch {
          await sleep(RESOLVE_INTERVAL_MS);
        }
      }
      if (!resolved) {
        throw new Error("emulator never became visible to adb — is the emulator window opening?");
      }
      await invoke("wait_booted", { serial: resolved });
      setBoot((cur) => applyBootEvent(cur, { type: "reset" }));
      await refresh(true);
      onSelect(resolved);
      setOpen(false);
    } catch (e) {
      setBoot((cur) =>
        applyBootEvent(cur, { type: "fail", avdName: name, message: errorText(e) }),
      );
    }
  }

  const booting = boot.phase === "booting" ? boot.avdName : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-2 rounded-md border border-line bg-bg px-2 text-[12px] text-txt hover:border-muted/50"
      >
        <MonitorSmartphone size={13} className="text-muted" />
        <span className="max-w-52 truncate font-mono">
          {booting ? `Booting ${booting}…` : serial || "select device"}
        </span>
        {booting ? (
          <Loader2 size={13} className="animate-spin text-accent" />
        ) : (
          <ChevronDown size={13} className="text-muted" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-80 rounded-md border border-line bg-surface-2 p-1.5 shadow-xl">
          {error && (
            <p className="px-2 py-2 text-[11px] leading-relaxed text-danger">{error}</p>
          )}
          {status === "loading" && options.length === 0 && (
            <p className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted">
              <Loader2 size={12} className="animate-spin" /> Searching for devices…
            </p>
          )}
          {status !== "loading" && !error && options.length === 0 && (
            <p className="px-2 py-2 text-[11px] text-muted">No devices or emulators found.</p>
          )}
          {running.length > 0 && (
            <p className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wider text-muted/70">
              running
            </p>
          )}
          {running.map((o) => (
            <DeviceRow
              key={o.id}
              option={o}
              active={serial === o.id}
              onSelect={() => {
                setOpen(false);
                onSelect(o.id);
              }}
            />
          ))}
          {stopped.length > 0 && (
            <p className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wider text-muted/70">
              stopped avds
            </p>
          )}
          {stopped.map((o) => (
            <AvdRow
              key={o.id}
              option={o}
              booting={booting === o.name}
              disabled={booting != null}
              onBoot={() => bootAvd(o.name)}
            />
          ))}
          {boot.phase === "error" && (
            <p className="px-2 py-2 text-[11px] leading-relaxed text-danger" title={boot.message}>
              {boot.message}
            </p>
          )}
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={refreshing}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12px] text-muted hover:bg-surface disabled:opacity-40"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      )}
    </div>
  );
}

function DeviceRow({
  option,
  active,
  onSelect,
}: {
  option: RunningDeviceOption;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-surface",
        active && "bg-surface",
      )}
    >
      {option.isEmulator ? (
        <CircleDot size={12} className="shrink-0 text-ok" />
      ) : (
        <Smartphone size={12} className="shrink-0 text-accent" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-txt/90">{option.serial}</span>
      <span className="shrink-0 text-[10px] text-muted/70">
        {option.isEmulator ? "emulator" : "device"}
      </span>
      {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
    </button>
  );
}

function AvdRow({
  option,
  booting,
  disabled,
  onBoot,
}: {
  option: StoppedAvdOption;
  booting: boolean;
  disabled: boolean;
  onBoot: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onBoot}
      disabled={disabled}
      className={clsx(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-surface",
        booting && "bg-surface",
      )}
    >
      {booting ? (
        <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
      ) : (
        <span className="h-3 w-3 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-txt/90">
        {booting ? `Booting ${option.name}…` : option.name}
      </span>
      <span className="shrink-0 text-[10px] text-muted/70">
        {option.beholderReady ? `API ${option.apiLevel ?? "?"}` : "no root"}
      </span>
    </button>
  );
}
