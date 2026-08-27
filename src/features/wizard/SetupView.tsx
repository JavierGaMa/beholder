import { useEffect, useState } from "react";
import { RefreshCw, ShieldOff, Play, Square } from "lucide-react";
import { useTraffic } from "../../store/traffic";
import { invoke } from "../../lib/tauri";
import type { Device } from "../../store/types";
import { Badge, Panel } from "../../components/ui/primitives";

export function SetupView() {
  const setCapture = useTraffic((s) => s.setCapture);
  const captureOn = useTraffic((s) => s.captureOn);
  const capturePort = useTraffic((s) => s.capturePort);
  const [adbPath, setAdbPath] = useState<string | null>(null);
  const [adbError, setAdbError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proxyNow, setProxyNow] = useState<string | null>(null);

  async function refreshAdb() {
    try {
      const path = await invoke<string>("adb_status");
      setAdbPath(path);
      setAdbError(null);
      const list = await invoke<Device[]>("list_devices");
      setDevices(list);
      const firstEmu = list.find((d) => d.is_emulator && d.state === "Online");
      if (firstEmu) setSelected((s) => s ?? firstEmu.serial);
      if (firstEmu) {
        setProxyNow(await invoke<string | null>("current_proxy", { serial: firstEmu.serial }));
      }
    } catch (e) {
      setAdbPath(null);
      setAdbError(String(e));
    }
  }

  useEffect(() => {
    refreshAdb();
  }, []);

  async function start() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const capMb = Number(localStorage.getItem("beholder.bodyCapMb")) || 2;
      const port = await invoke<number>("capture_start", {
        serial: selected,
        bodyCap: Math.round(capMb * 1024 * 1024),
      });
      setCapture(true, port);
      setProxyNow(`10.0.2.2:${port}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await invoke("capture_stop");
      setCapture(false);
      setProxyNow(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fullCleanup() {
    setBusy(true);
    try {
      await invoke("full_cleanup");
      setCapture(false);
      setProxyNow(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-sm font-semibold text-txt">Setup</h1>

      <Panel className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] font-medium text-txt">adb</p>
            {adbPath ? (
              <p className="mt-1 font-mono text-[12px] text-accent">{adbPath}</p>
            ) : (
              <p className="mt-1 text-[12px] text-danger">{adbError ?? "not found"}</p>
            )}
          </div>
          <button
            type="button"
            onClick={refreshAdb}
            className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[12px] text-muted hover:text-txt"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        {!adbPath && (
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Install Android Studio platform-tools or set <code className="font-mono">ANDROID_HOME</code>.
            Beholder also looks in <code className="font-mono">~/Library/Android/sdk</code>.
          </p>
        )}
      </Panel>

      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Emulators</p>
        <p className="mt-1 text-[11px] text-muted">
          v1 supports emulators only. Google Play images refuse <code className="font-mono">adb root</code> — use a
          Google APIs or AOSP image.
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          {devices.length === 0 && (
            <p className="text-[12px] text-muted">
              No devices detected. Launch an emulator from Android Studio, then refresh.
            </p>
          )}
          {devices.map((d) => (
            <button
              key={d.serial}
              type="button"
              disabled={!d.is_emulator || d.state !== "Online"}
              onClick={() => setSelected(d.serial)}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-[12px] transition-colors ${
                selected === d.serial ? "border-accent bg-surface-2" : "border-line hover:border-muted/40"
              } ${!d.is_emulator || d.state !== "Online" ? "opacity-50" : ""}`}
            >
              <span className="font-mono">{d.serial}</span>
              <span className="flex items-center gap-2">
                {!d.is_emulator && <Badge tone="muted">physical — v1: emulators</Badge>}
                {d.is_emulator && <Badge tone={d.state === "Online" ? "ok" : "warn"}>{d.state}</Badge>}
              </span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="p-4">
        <p className="text-[12px] font-medium text-txt">Capture</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Beholder installs its CA as an Android <em>system</em> certificate (requires rooted emulator) and sets the
          emulator global proxy to <code className="font-mono">10.0.2.2</code>. The proxy is always reverted when you
          stop capture or quit the app. The CA stays installed for faster next sessions — remove it with Full cleanup.
        </p>
        {proxyNow && (
          <p className="mt-2 font-mono text-[12px] text-accent">active proxy: {proxyNow}</p>
        )}
        {captureOn && capturePort != null && (
          <p className="mt-1 font-mono text-[12px] text-muted">listening on 127.0.0.1:{capturePort}</p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!selected || busy || captureOn}
            onClick={start}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-40"
          >
            <Play size={13} /> Start capture
          </button>
          <button
            type="button"
            disabled={busy || !captureOn}
            onClick={stop}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-txt disabled:opacity-40"
          >
            <Square size={13} /> Stop
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={fullCleanup}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:text-danger disabled:opacity-40"
          >
            <ShieldOff size={13} /> Full cleanup
          </button>
        </div>
        {error && (
          <p className="mt-3 whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/10 p-2 text-[12px] text-danger">
            {error}
          </p>
        )}
      </Panel>
    </div>
  );
}
