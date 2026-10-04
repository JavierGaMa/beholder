import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import clsx from "clsx";
import {
  Check,
  ChevronDown,
  CircleDot,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Square,
} from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import { qError } from "../../lib/query";
import { loadBodyCapMb } from "../../lib/prefs";
import { useAdbDevicesQuery } from "../../queries/devices";
import { useAvdsQuery, useInvalidateEmulators } from "../../queries/emulators";
import { useCaptureHealthQuery, type CaptureCheckT } from "../../queries/captureHealth";
import type { AvdInfo } from "../../store/types";
import { useTraffic, type View } from "../../store/traffic";
import { isFailed, type Filters } from "../requests/filters";
import { RequestsToolbar } from "../requests/RequestsToolbar";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { Badge } from "../../components/ui/primitives";
import { Button } from "../../components/ui/Button";
import { Menu, type MenuOption } from "../../components/ui/Menu";
import { Tooltip } from "../../components/ui/Tooltip";

const VIEW_LABELS: Record<View, string> = {
  requests: "Requests",
  websockets: "WebSockets",
  emulators: "Emulators",
  apks: "APKs",
  database: "Databases",
  console: "Console",
};

export function isTrafficView(view: View): boolean {
  return view === "requests" || view === "websockets";
}

export function CommandBar({
  sidebarCollapsed,
  onToggleSidebar,
  filters,
  onFiltersChange,
  follow,
  onFollowChange,
  searchRef,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const activeView = useTraffic((s) => s.activeView);
  const captureOn = useTraffic((s) => s.captureOn);
  const capturePort = useTraffic((s) => s.capturePort);
  const metro = useTraffic((s) => s.metro);
  const exchanges = useTraffic((s) => s.exchanges);
  const order = useTraffic((s) => s.order);
  const targetSerial = useTraffic((s) => s.targetSerial);
  const targetAvd = useTraffic((s) => s.targetAvd);
  const setTarget = useTraffic((s) => s.setTarget);
  const setActiveView = useTraffic((s) => s.setActiveView);
  const setCapture = useTraffic((s) => s.setCapture);
  const settingsOpen = useTraffic((s) => s.settingsOpen);
  const setSettingsOpen = useTraffic((s) => s.setSettingsOpen);
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

  const failures = useMemo(
    () => order.filter((id) => { const ex = exchanges.get(id); return ex ? isFailed(ex) : false; }).length,
    [order, exchanges],
  );

  const showCapture = isTrafficView(activeView);

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

  const label = targetAvd ?? targetSerial ?? "select target";

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

  return (
    <header
      data-tauri-drag-region
      className="app-toolbar relative z-30 h-11 shrink-0 border-b border-line bg-surface"
    >
      <div className="flex h-full flex-nowrap items-center gap-2 overflow-hidden px-2">
        <Tooltip label={sidebarCollapsed ? "Expand sidebar (Cmd/Ctrl+B)" : "Collapse sidebar (Cmd/Ctrl+B)"}>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </Button>
        </Tooltip>

        <div data-tauri-drag-region className="min-w-0 flex-1" />

        <div className="flex min-w-0 max-w-3xl flex-auto items-center justify-center overflow-hidden">
          {activeView === "requests" ? (
            <RequestsToolbar
              filters={filters}
              onChange={onFiltersChange}
              follow={follow}
              onFollowChange={onFollowChange}
              searchRef={searchRef}
            />
          ) : (
            <span className="min-w-0 truncate px-2 text-[12px] font-medium text-muted">
              {VIEW_LABELS[activeView]}
            </span>
          )}
        </div>

        <div data-tauri-drag-region className="min-w-0 flex-1" />

        <div className="flex min-w-0 items-center gap-2">
          {showCapture && (
            <>
              <span
                title={captureOn ? "Capture running" : "Capture stopped"}
                className={clsx(
                  "h-2.5 w-2.5 shrink-0 rounded-full",
                  captureOn ? "animate-pulse bg-ok" : "bg-muted/50",
                )}
              />

              <Menu
                items={targetItems}
                onClose={() => {}}
                width={320}
                trigger={(t) => (
                  <Button
                    ref={t.ref}
                    variant="ghost"
                    className="min-w-0"
                    onClick={() => {
                      void refreshAvds();
                      t.onClick();
                    }}
                    aria-haspopup="menu"
                    aria-expanded={t["aria-expanded"]}
                    title="Select emulator target"
                  >
                    <MonitorSmartphone size={13} className="shrink-0 text-muted" />
                    <span className="min-w-12 max-w-40 truncate font-mono">{label}</span>
                    <ChevronDown size={13} className="shrink-0 text-muted" />
                  </Button>
                )}
              />

              <Button
                variant={captureOn ? "danger" : "primary"}
                icon={captureOn ? Square : Play}
                disabled={busy || (!captureOn && !targetSerial)}
                onClick={toggleCapture}
                className="shrink-0 whitespace-nowrap"
                title={captureOn ? "Stop capture" : targetSerial ? "Start capture" : "Select a running emulator first"}
              >
                {captureOn ? "Stop" : "Capture"}
              </Button>

              <div className="hidden shrink-0 items-center gap-3 font-mono text-[11px] text-muted lg:flex">
                {captureOn && (
                  <CaptureDoctor
                    checks={checks}
                    unknown={healthQ.isPending || healthQ.isError}
                    busy={busy}
                    hasTarget={targetSerial != null}
                    onRestart={restartCapture}
                  />
                )}
                {captureOn && capturePort != null && <span className="text-accent">:{capturePort}</span>}
                {captureOn && metro?.detected && (
                  <Badge tone="accent">
                    Metro :{metro.port}
                  </Badge>
                )}
                <span>{order.length} req</span>
                {failures > 0 && <span className="text-danger">{failures} fail</span>}
              </div>
            </>
          )}

          <Tooltip label="Settings">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => setSettingsOpen(!settingsOpen)}
              aria-label="Settings"
            >
              <Settings size={15} />
            </Button>
          </Tooltip>
        </div>
      </div>

      {error && (
        <div className="anim-pop-in absolute right-2 top-full z-40 w-80 max-w-[calc(100vw-1rem)]">
          <ErrorBox message={error} />
        </div>
      )}
    </header>
  );
}

function checkTextCls(status: CaptureCheckT["status"]): string {
  if (status === "fail") return "text-danger";
  if (status === "warn") return "text-warn";
  return "text-ok";
}

function CaptureDoctor({
  checks,
  unknown,
  busy,
  hasTarget,
  onRestart,
}: {
  checks: CaptureCheckT[];
  unknown: boolean;
  busy: boolean;
  hasTarget: boolean;
  onRestart: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const anyFail = checks.some((c) => c.status === "fail");
  const anyWarn = checks.some((c) => c.status === "warn");
  const dotCls = unknown
    ? "bg-muted/50"
    : anyFail
      ? "animate-pulse bg-danger"
      : anyWarn
        ? "bg-warn"
        : "bg-ok";

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        title="Capture doctor"
        aria-expanded={open}
      >
        <span className={clsx("h-2 w-2 rounded-full", dotCls)} />
      </Button>
      {open && (
        <div className="anim-pop-in absolute right-0 top-5 w-80 rounded-[var(--radius-md)] border border-line bg-surface-2 p-1.5 shadow-[var(--shadow-3)]">
          <p className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wider text-muted/70">Capture doctor</p>
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
