import type { LogLevel, LogStatus, PaneMode } from "../../store/console-types";
import type { LineStats } from "./rows";

export function showLogFilters(mode: PaneMode): boolean {
  return mode === "logs";
}

export interface SeverityOption {
  level: LogLevel | null;
  label: string;
  short: string;
  title: string;
  count: number | null;
}

export function severityOptions(lineCount: number, stats: LineStats): SeverityOption[] {
  return [
    { level: null, label: "All", short: "All", title: "Show all log levels", count: lineCount },
    { level: "Info", label: "Info and up", short: "Info+", title: "Show Info and above", count: null },
    { level: "Warn", label: "Warnings", short: "Warn+", title: "Show Warn and above", count: stats.warns },
    { level: "Error", label: "Errors", short: "Error+", title: "Show Error and above", count: stats.errors },
  ];
}

export type PillTone = "accent" | "warn" | "danger" | "muted";

export interface StreamPill {
  text: string;
  tone: PillTone;
  pulse: boolean;
}

export function streamPill(status: LogStatus): StreamPill {
  if (status === "Streaming") return { text: "Streaming", tone: "accent", pulse: true };
  if (status === "Disconnected") return { text: "Retrying", tone: "warn", pulse: false };
  if (typeof status === "object") return { text: "Failed", tone: "danger", pulse: false };
  return { text: "Stopped", tone: "muted", pulse: false };
}

export function crashSummary(message: string): string {
  const lines = message.split("\n");
  const first = lines[0] ?? "";
  if (!first.startsWith("FATAL EXCEPTION")) return first;
  const detail = lines.slice(1).map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith("Process:"));
  return detail ?? first;
}
