import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  ArrowLeftRight,
  MonitorSmartphone,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  SquareTerminal,
  Waves,
  X,
} from "lucide-react";
import { useTraffic, type View } from "./store/traffic";
import { useConsole } from "./store/console";
import type { ConsoleEvent } from "./store/console-types";
import { invoke, isTauri, listenTraffic } from "./lib/tauri";
import { applyUiConfig } from "./lib/theme/applyConfig";
import type { UiConfig } from "./lib/theme/config-types";
import { loadSidebarCollapsed, saveSidebarCollapsed } from "./lib/prefs";
import { startMock } from "./lib/mock";
import { CommandBar } from "./features/capture/CommandBar";
import { RequestsView } from "./features/requests/RequestsView";
import { WebSocketsView } from "./features/websockets/WebSocketsView";
import { EmulatorsView } from "./features/emulators/EmulatorsView";
import { ApksView } from "./features/apks/ApksView";
import { SettingsView } from "./features/settings/SettingsView";
import { ConsoleView } from "./features/console/ConsoleView";
import { OnboardingPanel } from "./features/emulators/OnboardingPanel";
import { Toaster } from "./components/ui/toast";

const NAV_GROUPS: { label: string; items: { id: View; label: string; icon: typeof Waves }[] }[] = [
  {
    label: "Traffic",
    items: [
      { id: "requests", label: "Requests", icon: ArrowLeftRight },
      { id: "websockets", label: "WebSockets", icon: Waves },
    ],
  },
  {
    label: "Device",
    items: [
      { id: "emulators", label: "Emulators", icon: MonitorSmartphone },
      { id: "apks", label: "APKs", icon: Package },
      { id: "console", label: "Console", icon: SquareTerminal },
    ],
  },
];

const RAIL = NAV_GROUPS.flatMap((g) => g.items);

export default function App() {
  const activeView = useTraffic((s) => s.activeView);
  const setActiveView = useTraffic((s) => s.setActiveView);
  const ingest = useTraffic((s) => s.ingest);
  const settingsOpen = useTraffic((s) => s.settingsOpen);
  const setSettingsOpen = useTraffic((s) => s.setSettingsOpen);
  const onboarding = useTraffic((s) => s.onboarding);
  const setOnboarding = useTraffic((s) => s.setOnboarding);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(loadSidebarCollapsed);

  useEffect(() => {
    saveSidebarCollapsed(sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (isTauri) {
      invoke<UiConfig>("get_config")
        .then((c) => {
          useTraffic.getState().setUiConfig(c);
          applyUiConfig(c);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let disposeInstall: (() => void) | undefined;
    let disposeConfig: (() => void) | undefined;
    let disposeConsole: (() => void) | undefined;
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
        listen<UiConfig>("config-changed", (e) => {
          useTraffic.getState().setUiConfig(e.payload);
          applyUiConfig(e.payload);
        }).then((un) => {
          disposeConfig = un;
        });
        listen<ConsoleEvent[]>("console-batch", (e) => {
          useConsole.getState().ingest(e.payload);
        }).then((un) => {
          disposeConsole = un;
        });
      });
    }
    return () => {
      dispose?.();
      disposeInstall?.();
      disposeConfig?.();
      disposeConsole?.();
      stopMockFn?.();
    };
  }, [ingest]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarCollapsed((c) => !c);
        return;
      }
      const idx = Number(e.key) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= RAIL.length) return;
      e.preventDefault();
      setActiveView(RAIL[idx].id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setActiveView]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg text-txt">
      <CommandBar />
      <div className="flex min-h-0 flex-1">
        <aside
          className={clsx(
            "flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface transition-[width] duration-200",
            sidebarCollapsed ? "w-12" : "w-44",
          )}
        >
          <nav className="flex flex-col p-2" aria-label="Views">
            {NAV_GROUPS.map((group, gi) => (
              <div
                key={group.label}
                className={clsx(
                  gi > 0 && (sidebarCollapsed ? "mt-2 border-t border-line pt-2" : "mt-4"),
                )}
              >
                {!sidebarCollapsed && (
                  <p className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted/70">
                    {group.label}
                  </p>
                )}
                <div className="flex flex-col gap-0.5">
                  {group.items.map(({ id, label, icon: Icon }) => {
                    const shortcut = 1 + RAIL.findIndex((r) => r.id === id);
                    const active = activeView === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setActiveView(id)}
                        aria-label={label}
                        className={clsx(
                          "group relative flex items-center gap-2.5 rounded-md py-1.5 text-[12px] font-medium transition-colors",
                          sidebarCollapsed ? "justify-center" : "px-2.5",
                          active
                            ? "bg-accent/10 text-accent"
                            : "text-muted hover:bg-surface-2 hover:text-txt",
                        )}
                      >
                        <Icon size={16} className="shrink-0" />
                        {!sidebarCollapsed && <span>{label}</span>}
                        {!sidebarCollapsed && (
                          <span
                            className={clsx(
                              "ml-auto rounded border px-1 py-px font-mono text-[9px] leading-none",
                              active
                                ? "border-accent/30 text-accent/70"
                                : "border-line text-muted/60",
                            )}
                          >
                            {shortcut}
                          </span>
                        )}
                        {sidebarCollapsed && (
                          <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded border border-line bg-surface-2 px-2 py-1 text-[11px] text-txt opacity-0 shadow-lg transition-opacity delay-150 group-focus-visible:opacity-100 group-hover:opacity-100">
                            {label}
                            <span className="font-mono text-[9px] text-muted">{shortcut}</span>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-auto p-2 pt-0">
            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand (Cmd/Ctrl+B)" : "Collapse (Cmd/Ctrl+B)"}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-line text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-txt"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              {!sidebarCollapsed && <span>Collapse</span>}
            </button>
          </div>
        </aside>
        <main className="min-h-0 min-w-0 flex-1">
          {activeView === "requests" && <RequestsView />}
          {activeView === "websockets" && <WebSocketsView />}
          {activeView === "emulators" && <EmulatorsView />}
          {activeView === "apks" && <ApksView />}
          {activeView === "console" && <ConsoleView />}
        </main>
      </div>

      <Toaster />

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
        <div className="absolute bottom-6 right-6 z-40 w-[420px] shadow-2xl">
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
