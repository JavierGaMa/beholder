import type { ComponentType } from "react";
import {
  ArrowLeftRight,
  Database,
  Gauge,
  MonitorSmartphone,
  Package,
  PanelLeft,
  Pin,
  Search,
  Settings,
  SquareTerminal,
  Trash2,
  Waves,
} from "lucide-react";
import { useTraffic, type View } from "../../store/traffic";
import { fuzzyScore } from "./fuzzy";

export type PaletteSection = "Navigate" | "Actions";

export type PaletteIcon = ComponentType<{ size?: number; className?: string }>;

export interface PaletteCommand {
  id: string;
  label: string;
  section: PaletteSection;
  shortcut?: string;
  icon: PaletteIcon;
  run: () => void;
}

export interface PaletteHandlers {
  toggleSidebar: () => void;
  toggleFollow: () => void;
  focusSearch: () => void;
}

const VIEW_COMMANDS: { view: View; label: string; icon: PaletteIcon; shortcut: string }[] = [
  { view: "requests", label: "Go to Requests", icon: ArrowLeftRight, shortcut: "1" },
  { view: "websockets", label: "Go to WebSockets", icon: Waves, shortcut: "2" },
  { view: "metrics", label: "Go to Metrics", icon: Gauge, shortcut: "3" },
  { view: "emulators", label: "Go to Emulators", icon: MonitorSmartphone, shortcut: "4" },
  { view: "apks", label: "Go to APKs", icon: Package, shortcut: "5" },
  { view: "database", label: "Go to Databases", icon: Database, shortcut: "6" },
  { view: "console", label: "Go to Console", icon: SquareTerminal, shortcut: "7" },
];

export const PALETTE_SECTIONS: PaletteSection[] = ["Navigate", "Actions"];

export function buildPaletteCommands(handlers: PaletteHandlers): PaletteCommand[] {
  const navigate: PaletteCommand[] = VIEW_COMMANDS.map(({ view, label, icon, shortcut }) => ({
    id: `go-to-${view}`,
    label,
    section: "Navigate",
    shortcut,
    icon,
    run: () => useTraffic.getState().setActiveView(view),
  }));
  const actions: PaletteCommand[] = [
    {
      id: "open-settings",
      label: "Open Settings",
      section: "Actions",
      icon: Settings,
      run: () => useTraffic.getState().setSettingsOpen(true),
    },
    {
      id: "toggle-sidebar",
      label: "Toggle Sidebar",
      section: "Actions",
      shortcut: "B",
      icon: PanelLeft,
      run: handlers.toggleSidebar,
    },
    {
      id: "toggle-follow",
      label: "Toggle Follow",
      section: "Actions",
      icon: Pin,
      run: handlers.toggleFollow,
    },
    {
      id: "clear-requests",
      label: "Clear Requests",
      section: "Actions",
      icon: Trash2,
      run: () => useTraffic.getState().clear(),
    },
    {
      id: "focus-search",
      label: "Focus Search",
      section: "Actions",
      shortcut: "F",
      icon: Search,
      run: handlers.focusSearch,
    },
  ];
  return [...navigate, ...actions];
}

function orderCommands(commands: PaletteCommand[], recent: string[]): PaletteCommand[] {
  return PALETTE_SECTIONS.flatMap((section) => {
    const inSection = commands.filter((c) => c.section === section);
    const recentInSection = recent
      .map((id) => inSection.find((c) => c.id === id))
      .filter((c): c is PaletteCommand => c !== undefined);
    const rest = inSection.filter((c) => !recent.includes(c.id));
    return [...recentInSection, ...rest];
  });
}

export function searchCommands(
  commands: PaletteCommand[],
  query: string,
  recent: string[] = [],
): PaletteCommand[] {
  const q = query.trim();
  if (q.length === 0) return orderCommands(commands, recent);
  const scored: { cmd: PaletteCommand; i: number; score: number }[] = [];
  for (let i = 0; i < commands.length; i++) {
    const score = fuzzyScore(q, commands[i].label);
    if (score !== null) scored.push({ cmd: commands[i], i, score });
  }
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.cmd);
}
