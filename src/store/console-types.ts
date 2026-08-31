export type LogLevel = "Verbose" | "Debug" | "Info" | "Warn" | "Error" | "Fatal";

export type LogBuffer = "Main" | "System" | "Crash" | "Radio" | "Events";

export interface LogLine {
  ts_ms: number;
  level: LogLevel;
  pid: number;
  tid: number;
  tag: string;
  buffer: LogBuffer;
  message: string;
  is_crash: boolean;
  repeat_count: number;
}

export type LogStatus = "Streaming" | "Disconnected" | { Failed: string } | "Stopped";

export type ConsoleEvent = { Line: LogLine } | { Status: LogStatus };

export interface LogFilter {
  pid: number | null;
  min_level: LogLevel | null;
  tags: string[];
}

export interface GapMarker {
  kind: "gap";
  dropped: number;
}

export type ConsoleEntry = LogLine | GapMarker;

export type PaneMode = "logs" | "timeline";

export interface ConsoleColumns {
  time: boolean;
  level: boolean;
  tag: boolean;
  pid: boolean;
  tid: boolean;
}

export interface AppProcess {
  package: string;
  pid: number | null;
}

export interface AppFilter {
  package: string;
  pid: number | null;
}

export function isLogLine(entry: ConsoleEntry): entry is LogLine {
  return (entry as GapMarker).kind !== "gap";
}
