import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArrowLeftRight,
  Database,
  MonitorSmartphone,
  Package,
  SquareTerminal,
  Waves,
  X,
} from "lucide-react";
import { useTraffic, type MetroStatus, type View } from "./store/traffic";
import { useConsole } from "./store/console";
import type { ConsoleEvent } from "./store/console-types";
import { invoke, isTauri, listenTraffic } from "./lib/tauri";
import { applyUiConfig } from "./lib/theme/applyConfig";
import type { UiConfig } from "./lib/theme/config-types";
import {
  loadFilters,
  loadFollow,
  loadSidebarCollapsed,
  saveFilters,
  saveFollow,
  saveSidebarCollapsed,
} from "./lib/prefs";
import { startMock } from "./lib/mock";
import { CommandBar } from "./features/capture/CommandBar";
import type { Filters } from "./features/requests/filters";
import { RequestsView } from "./features/requests/RequestsView";
import { WebSocketsView } from "./features/websockets/WebSocketsView";
import { EmulatorsView } from "./features/emulators/EmulatorsView";
import { ApksView } from "./features/apks/ApksView";
import { DatabasesView } from "./features/database/DatabasesView";
import { SettingsView } from "./features/settings/SettingsView";
import { ConsoleView } from "./features/console/ConsoleView";
import { OnboardingPanel } from "./features/emulators/OnboardingPanel";
import { SetupView } from "./features/setup/SetupView";
import { UpdateBanner } from "./features/updater/UpdateBanner";
import { Toaster } from "./components/ui/toast";
import { Modal } from "./components/ui/Modal";
import { Drawer } from "./components/ui/Drawer";
import { Button } from "./components/ui/Button";

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
      { id: "database", label: "Databases", icon: Database },
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
  const setupOpen = useTraffic((s) => s.setupOpen);
  const setSetupOpen = useTraffic((s) => s.setSetupOpen);
  const onboarding = useTraffic((s) => s.onboarding);
  const setOnboarding = useTraffic((s) => s.setOnboarding);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(loadSidebarCollapsed);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [follow, setFollow] = useState<boolean>(loadFollow);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveSidebarCollapsed(sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  useEffect(() => {
    saveFollow(follow);
  }, [follow]);

  useEffect(() => {
    if (isTauri) {
      invoke<UiConfig>("get_config")
        .then((c) => {
          useTraffic.getState().setUiConfig(c);
          applyUiConfig(c);
        })
        .catch(() => {});
      invoke<{ status: string }[]>("run_host_doctor")
        .then((checks) => {
          if (checks.some((c) => c.status === "fail")) {
            useTraffic.getState().setSetupOpen(true);
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let disposeInstall: (() => void) | undefined;
    let disposeConfig: (() => void) | undefined;
    let disposeConsole: (() => void) | undefined;
    let disposeMetro: (() => void) | undefined;
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
        listen<MetroStatus>("metro-status", (e) => {
          useTraffic.getState().setMetro(e.payload);
        }).then((un) => {
          disposeMetro = un;
        });
      });
    }
    return () => {
      dispose?.();
      disposeInstall?.();
      disposeConfig?.();
      disposeConsole?.();
      disposeMetro?.();
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
    <div className="flex h-full w-full flex-col overflow-hidden text-txt">
      <CommandBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
        filters={filters}
        onFiltersChange={setFilters}
        follow={follow}
        onFollowChange={setFollow}
        searchRef={searchRef}
      />
      <UpdateBanner />
      <div className="flex min-h-0 flex-1">
        <aside
          className={clsx(
            "flex shrink-0 flex-col overflow-hidden border-r border-line bg-[var(--window-tint)] transition-[width] duration-200",
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
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "press focus-ring group relative flex items-center gap-2.5 rounded-md py-1.5 text-[12px] font-medium",
                          sidebarCollapsed ? "justify-center" : "px-2.5",
                          active
                            ? "bg-accent/10 text-accent"
                            : "text-muted hover:bg-surface-2 hover:text-txt",
                        )}
                      >
                        {active && (
                          <span className="absolute left-0.5 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-accent" />
                        )}
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
        </aside>
        <main className="min-h-0 min-w-0 flex-1 bg-bg">
          <div key={activeView} className="anim-view-enter h-full min-h-0">
            {activeView === "requests" && (
              <RequestsView
                filters={filters}
                follow={follow}
                onFollowChange={setFollow}
                searchRef={searchRef}
              />
            )}
            {activeView === "websockets" && <WebSocketsView />}
            {activeView === "emulators" && <EmulatorsView />}
            {activeView === "apks" && <ApksView />}
            {activeView === "database" && <DatabasesView />}
            {activeView === "console" && <ConsoleView />}
          </div>
        </main>
      </div>

      <Toaster />

      <Modal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        width={560}
        ariaLabel="Setup"
        className="max-w-full!"
      >
        <SetupView onClose={() => setSetupOpen(false)} />
      </Modal>

      <Drawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        width={384}
        ariaLabel="Settings"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg px-4 py-3">
          <span className="text-sm font-semibold">Settings</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(false)}
            aria-label="Close settings"
          >
            <X size={14} />
          </Button>
        </div>
        <SettingsView />
      </Drawer>

      {onboarding && (
        <div className="anim-pop-in absolute bottom-6 right-6 z-40 w-[420px] shadow-[var(--shadow-3)]">
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
