import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArrowLeftRight,
  Bot,
  Database,
  Gauge,
  MonitorSmartphone,
  Package,
  Route,
  Settings,
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
import { loadFilters, loadFollow, saveFilters, saveFollow } from "./lib/prefs";
import { startMock } from "./lib/mock";
import { CommandBar } from "./features/capture/CommandBar";
import type { Filters } from "./features/requests/filters";
import { RequestsView } from "./features/requests/RequestsView";
import { WebSocketsView } from "./features/websockets/WebSocketsView";
import { MetricsView } from "./features/metrics/MetricsView";
import { RoutesView } from "./features/routes/RoutesView";
import { useRoutes } from "./features/routes/store";
import { ConnectWizard } from "./features/routes/ConnectWizard";
import { useRefreshRoutesOnCapture } from "./queries/routes";
import { EmulatorsView } from "./features/emulators/EmulatorsView";
import { ApksView } from "./features/apks/ApksView";
import { DatabasesView } from "./features/database/DatabasesView";
import { SettingsView } from "./features/settings/SettingsView";
import {
  isAgentClientActive,
  type AgentConnections,
} from "./features/settings/agentBridge";
import { rememberActiveSection } from "./features/settings/sections";
import { ConsoleView } from "./features/console/ConsoleView";
import { OnboardingPanel } from "./features/emulators/OnboardingPanel";
import { SetupView } from "./features/setup/SetupView";
import { UpdateBanner } from "./features/updater/UpdateBanner";
import { Palette } from "./features/palette/Palette";
import { buildPaletteCommands } from "./features/palette/commands";
import { usePalette } from "./features/palette/store";
import { ShortcutsOverlay } from "./features/shortcuts/ShortcutsOverlay";
import { useShortcuts } from "./features/shortcuts/store";
import { Toaster } from "./components/ui/toast";
import { Modal } from "./components/ui/Modal";
import { Tooltip } from "./components/ui/Tooltip";
import { Button } from "./components/ui/Button";

const NAV_GROUPS: { label: string; items: { id: View; label: string; icon: typeof Waves }[] }[] = [
  {
    label: "Traffic",
    items: [
      { id: "requests", label: "Requests", icon: ArrowLeftRight },
      { id: "websockets", label: "WebSockets", icon: Waves },
      { id: "metrics", label: "Metrics", icon: Gauge },
      { id: "routes", label: "Routes", icon: Route },
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
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [follow, setFollow] = useState<boolean>(loadFollow);
  const [agentConnections, setAgentConnections] = useState<AgentConnections | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  useRefreshRoutesOnCapture();

  const paletteCommands = useMemo(
    () =>
      buildPaletteCommands({
        toggleFollow: () => setFollow((f) => !f),
        focusSearch: () => {
          setActiveView("requests");
          requestAnimationFrame(() => {
            searchRef.current?.focus();
            searchRef.current?.select();
          });
        },
      }),
    [setActiveView],
  );

  useEffect(() => {
    if (!settingsOpen) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    settingsCloseRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !useShortcuts.getState().open && !usePalette.getState().open) {
        setSettingsOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [settingsOpen, setSettingsOpen]);

  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  useEffect(() => {
    saveFollow(follow);
  }, [follow]);

  useEffect(() => {
    if (isTauri) {
      useRoutes.getState().sync();
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
      invoke<{ connections: AgentConnections }>("agent_bridge_status")
        .then((s) => setAgentConnections(s.connections))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let disposeInstall: (() => void) | undefined;
    let disposeConfig: (() => void) | undefined;
    let disposeConsole: (() => void) | undefined;
    let disposeMetro: (() => void) | undefined;
    let disposeAgent: (() => void) | undefined;
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
        listen<AgentConnections>("agent-connections", (e) => {
          setAgentConnections(e.payload);
        }).then((un) => {
          disposeAgent = un;
        });
      });
    }
    return () => {
      dispose?.();
      disposeInstall?.();
      disposeConfig?.();
      disposeConsole?.();
      disposeMetro?.();
      disposeAgent?.();
      stopMockFn?.();
    };
  }, [ingest]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = Boolean(
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable),
      );
      if (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        useShortcuts.getState().setOpen(true);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        usePalette.getState().toggle();
        return;
      }
      if (typing) return;
      const idx = Number(e.key) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= RAIL.length) return;
      e.preventDefault();
      setActiveView(RAIL[idx].id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setActiveView]);

  const agentConnected = isAgentClientActive(agentConnections);
  const badgeVisible = Boolean(agentConnections?.enabled);
  const agentBadgeLabel = agentConnected
    ? "Agent bridge: agent client connected, open Agent Bridge settings"
    : "Agent bridge enabled, no agent client connected, open Agent Bridge settings";

  function openAgentBridgeSettings() {
    rememberActiveSection("agent-bridge");
    setSettingsOpen(true);
  }

  return (
    <div className="app-frame flex h-full w-full flex-col overflow-hidden text-txt">
      <CommandBar />
      <div className="relative flex min-h-0 flex-1">
        <aside className="flex w-[54px] shrink-0 flex-col items-center pb-3 pt-0.5">
          <nav className="flex flex-col items-center gap-1" aria-label="Views">
            {NAV_GROUPS.map((group, gi) => (
              <div key={group.label} className="flex flex-col items-center gap-1">
                {gi > 0 && <span aria-hidden="true" className="my-1.5 h-px w-[18px] bg-line" />}
                {group.items.map(({ id, label, icon: Icon }) => {
                  const shortcut = 1 + RAIL.findIndex((r) => r.id === id);
                  const active = activeView === id;
                  return (
                    <Tooltip key={id} label={`${label} · ${shortcut}`} side="right">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveView(id);
                          setSettingsOpen(false);
                        }}
                        aria-label={label}
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "press focus-ring relative grid h-9 w-9 place-items-center rounded-[10px]",
                          active
                            ? "bg-surface text-txt shadow-[var(--shadow-2),inset_0_0_0_1px_var(--line)]"
                            : "text-muted hover:bg-surface-2 hover:text-txt",
                        )}
                      >
                        {active && (
                          <span
                            aria-hidden="true"
                            className="absolute -left-[9px] top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-[2px] bg-accent"
                          />
                        )}
                        <Icon size={18} strokeWidth={1.75} />
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="mt-auto flex flex-col items-center gap-1">
            <span style={{ visibility: badgeVisible ? "visible" : "hidden" }}>
              <Tooltip label={agentConnected ? "Agent connected" : "Agent bridge"} side="right">
                <button
                  type="button"
                  onClick={openAgentBridgeSettings}
                  aria-label={agentBadgeLabel}
                  className={clsx(
                    "press focus-ring relative grid h-9 w-9 place-items-center rounded-[10px] hover:bg-surface-2",
                    agentConnected ? "text-txt" : "text-muted hover:text-txt",
                  )}
                >
                  <Bot size={18} strokeWidth={1.75} />
                  <span
                    aria-hidden="true"
                    className={clsx(
                      "absolute right-[7px] top-[7px] h-1.5 w-1.5 rounded-full transition-colors duration-200",
                      agentConnected ? "bg-accent" : "bg-muted/50",
                    )}
                  />
                </button>
              </Tooltip>
            </span>
            <Tooltip label="Settings" side="right">
              <button
                type="button"
                onClick={() => setSettingsOpen(!settingsOpen)}
                aria-label="Settings"
                aria-pressed={settingsOpen}
                className={clsx(
                  "press focus-ring grid h-9 w-9 place-items-center rounded-[10px]",
                  settingsOpen
                    ? "bg-surface text-txt shadow-[var(--shadow-2),inset_0_0_0_1px_var(--line)]"
                    : "text-muted hover:bg-surface-2 hover:text-txt",
                )}
              >
                <Settings size={18} strokeWidth={1.75} />
              </button>
            </Tooltip>
          </div>
        </aside>
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-2 pb-2 pr-2">
          <UpdateBanner />
          <div key={activeView} className="anim-view-enter min-h-0 flex-1">
            {activeView === "requests" && (
              <RequestsView
                filters={filters}
                onFiltersChange={setFilters}
                follow={follow}
                onFollowChange={setFollow}
                searchRef={searchRef}
              />
            )}
            {activeView === "websockets" && <WebSocketsView />}
            {activeView === "metrics" && <MetricsView />}
            {activeView === "routes" && <RoutesView />}
            {activeView === "emulators" && <EmulatorsView />}
            {activeView === "apks" && <ApksView />}
            {activeView === "database" && <DatabasesView />}
            {activeView === "console" && <ConsoleView />}
          </div>

          {settingsOpen && (
            <div
              role="dialog"
              aria-label="Settings"
              className="panel anim-view-enter absolute bottom-2 left-0 right-2 top-0 z-30 flex flex-col"
            >
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-line pl-4 pr-2">
                <span className="text-[13px] font-semibold">Settings</span>
                <Tooltip label="Close (Esc)">
                  <Button
                    ref={settingsCloseRef}
                    variant="ghost"
                    size="icon"
                    onClick={() => setSettingsOpen(false)}
                    aria-label="Close settings"
                  >
                    <X size={14} />
                  </Button>
                </Tooltip>
              </div>
              <div className="min-h-0 flex-1">
                <SettingsView />
              </div>
            </div>
          )}
        </main>
      </div>

      <ConnectWizard />

      <Palette commands={paletteCommands} />

      <ShortcutsOverlay />

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

      {onboarding && (
        <div className="anim-pop-in absolute bottom-6 right-6 z-40 w-[420px] max-w-[calc(100vw-3rem)] shadow-[var(--shadow-3)]">
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
