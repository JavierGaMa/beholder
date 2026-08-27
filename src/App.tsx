import { useEffect } from "react";
import clsx from "clsx";
import { Cable, MonitorSmartphone, Radio, Settings, ShieldCheck, Waves } from "lucide-react";
import { useTraffic, type View } from "./store/traffic";
import { isTauri, listenTraffic } from "./lib/tauri";
import { startMock } from "./lib/mock";
import { RequestsView } from "./features/requests/RequestsView";
import { WebSocketsView } from "./features/websockets/WebSocketsView";
import { EmulatorsView } from "./features/emulators/EmulatorsView";
import { SetupView } from "./features/wizard/SetupView";
import { SettingsView } from "./features/settings/SettingsView";

const NAV: { id: View; label: string; icon: typeof Radio }[] = [
  { id: "requests", label: "Requests", icon: Radio },
  { id: "websockets", label: "WebSockets", icon: Waves },
  { id: "emulators", label: "Emulators", icon: MonitorSmartphone },
  { id: "setup", label: "Setup", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function App() {
  const activeView = useTraffic((s) => s.activeView);
  const setActiveView = useTraffic((s) => s.setActiveView);
  const ingest = useTraffic((s) => s.ingest);
  const captureOn = useTraffic((s) => s.captureOn);
  const capturePort = useTraffic((s) => s.capturePort);
  const requestCount = useTraffic((s) => s.requestCount);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let stopMockFn: (() => void) | undefined;
    listenTraffic((events) => ingest(events as never)).then((un) => {
      dispose = un;
    });
    if (!isTauri) {
      stopMockFn = startMock((events) => ingest(events));
    }
    return () => {
      dispose?.();
      stopMockFn?.();
    };
  }, [ingest]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg text-txt">
      <aside className="flex w-44 shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-3 py-3">
          <Cable size={16} className="text-accent" />
          <span className="text-[13px] font-semibold tracking-tight">Beholder</span>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveView(id)}
              className={clsx(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                activeView === id ? "bg-surface-2 text-accent" : "text-muted hover:bg-surface-2 hover:text-txt",
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto border-t border-line px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span
              className={clsx(
                "h-2 w-2 rounded-full",
                captureOn ? "animate-pulse bg-ok" : "bg-muted/50",
              )}
            />
            <span className="text-[11px] text-muted">{captureOn ? "capturing" : "idle"}</span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted/70">
            {captureOn && capturePort != null ? `:${capturePort} · ${requestCount} req` : `${requestCount} req`}
          </p>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {activeView === "requests" && <RequestsView />}
        {activeView === "websockets" && <WebSocketsView />}
        {activeView === "emulators" && <EmulatorsView />}
        {activeView === "setup" && <SetupView />}
        {activeView === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
