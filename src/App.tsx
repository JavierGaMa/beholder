import { useEffect } from "react";
import clsx from "clsx";
import { MonitorSmartphone, Radio, Waves, X } from "lucide-react";
import { useTraffic, type View } from "./store/traffic";
import { isTauri, listenTraffic } from "./lib/tauri";
import { startMock } from "./lib/mock";
import { CommandBar } from "./features/capture/CommandBar";
import { RequestsView } from "./features/requests/RequestsView";
import { WebSocketsView } from "./features/websockets/WebSocketsView";
import { EmulatorsView } from "./features/emulators/EmulatorsView";
import { SettingsView } from "./features/settings/SettingsView";
import { OnboardingPanel } from "./features/emulators/OnboardingPanel";

const RAIL: { id: View; label: string; icon: typeof Radio }[] = [
  { id: "requests", label: "Requests", icon: Radio },
  { id: "websockets", label: "WebSockets", icon: Waves },
  { id: "emulators", label: "Emulators", icon: MonitorSmartphone },
];

export default function App() {
  const activeView = useTraffic((s) => s.activeView);
  const setActiveView = useTraffic((s) => s.setActiveView);
  const ingest = useTraffic((s) => s.ingest);
  const settingsOpen = useTraffic((s) => s.settingsOpen);
  const setSettingsOpen = useTraffic((s) => s.setSettingsOpen);
  const onboarding = useTraffic((s) => s.onboarding);
  const setOnboarding = useTraffic((s) => s.setOnboarding);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let disposeInstall: (() => void) | undefined;
    let stopMockFn: (() => void) | undefined;
    listenTraffic((events) => ingest(events as never)).then((un) => {
      dispose = un;
    });
    if (!isTauri) {
      stopMockFn = startMock((events) => ingest(events));
    } else {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen<string>("install-log", (e) => {
          useTraffic.getState().setInstallLog(e.payload);
        }).then((un) => {
          disposeInstall = un;
        });
      });
    }
    return () => {
      dispose?.();
      disposeInstall?.();
      stopMockFn?.();
    };
  }, [ingest]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg text-txt">
      <CommandBar />
      <main className="min-h-0 flex-1">
        {activeView === "requests" && <RequestsView />}
        {activeView === "websockets" && <WebSocketsView />}
        {activeView === "emulators" && <EmulatorsView />}
      </main>
      <nav className="flex shrink-0 items-center justify-center gap-1 border-t border-line bg-surface px-4 py-1.5">
        {RAIL.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveView(id)}
            className={clsx(
              "flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-medium transition-colors",
              activeView === id ? "bg-surface-2 text-accent" : "text-muted hover:text-txt",
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </nav>

      {settingsOpen && (
        <div className="absolute inset-0 z-40 flex justify-end bg-black/40" onClick={() => setSettingsOpen(false)}>
          <div
            className="h-full w-96 overflow-y-auto border-l border-line bg-bg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg px-4 py-3">
              <span className="text-sm font-semibold">Settings</span>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-txt"
              >
                <X size={14} />
              </button>
            </div>
            <SettingsView />
          </div>
        </div>
      )}

      {onboarding && (
        <div className="absolute bottom-14 right-6 z-40 w-[420px] shadow-2xl">
          <OnboardingPanel
            avdName={onboarding.avdName}
            createdNew={onboarding.createdNew}
            onCancel={() => setOnboarding(null)}
          />
        </div>
      )}
    </div>
  );
}
