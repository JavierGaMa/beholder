export interface ShortcutEntry {
  keys: string;
  description: string;
}

export interface ShortcutGroup {
  label: string;
  entries: ShortcutEntry[];
}

export const VIEW_SHORTCUTS: { digit: string; view: string }[] = [
  { digit: "1", view: "requests" },
  { digit: "2", view: "websockets" },
  { digit: "3", view: "metrics" },
  { digit: "4", view: "emulators" },
  { digit: "5", view: "apks" },
  { digit: "6", view: "database" },
  { digit: "7", view: "console" },
];

const VIEW_LABELS: Record<string, string> = {
  requests: "Requests",
  websockets: "WebSockets",
  metrics: "Metrics",
  emulators: "Emulators",
  apks: "APKs",
  database: "Databases",
  console: "Console",
};

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Global",
    entries: [
      { keys: "Cmd/Ctrl+K", description: "Open the command palette" },
      { keys: "?", description: "Show keyboard shortcuts" },
      { keys: "Esc", description: "Close overlays and dialogs" },
    ],
  },
  {
    label: "Navigation",
    entries: VIEW_SHORTCUTS.map(({ digit, view }) => ({
      keys: `Cmd/Ctrl+${digit}`,
      description: `Go to ${VIEW_LABELS[view] ?? view}`,
    })),
  },
  {
    label: "Requests",
    entries: [
      { keys: "Cmd/Ctrl+F", description: "Focus the traffic search field" },
      { keys: "Up/Down", description: "Move the selection in the request list" },
    ],
  },
  {
    label: "SQL console",
    entries: [
      { keys: "Cmd/Ctrl+Enter", description: "Run the current query or selection" },
    ],
  },
];
