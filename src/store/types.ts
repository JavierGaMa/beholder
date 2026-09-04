export interface Header {
  name: string;
  value: string;
}

export interface BodyCapture {
  mime: string | null;
  size: number;
  truncated: boolean;
  text: string;
  is_binary: boolean;
}

export interface HttpRequest {
  method: string;
  url: string;
  host: string;
  path: string;
  headers: Header[];
  body?: BodyCapture | null;
  started_at: number;
}

export interface HttpResponse {
  status: number;
  headers: Header[];
  body?: BodyCapture | null;
  ended_at: number;
}

export interface Timing {
  ttfb_ms: number | null;
  download_ms: number | null;
  total_ms: number | null;
}

export interface HttpExchange {
  id: number;
  request: HttpRequest;
  response?: HttpResponse | null;
  error?: string | null;
  timing: Timing;
  protocol: string;
}

export type WsDirection = "Sent" | "Received";

export type WsEvent =
  | { kind: "Opened"; id: number; url: string; opened_at: number }
  | { kind: "Frame"; id: number; seq: number; direction: WsDirection; payload: BodyCapture; at: number }
  | { kind: "Closed"; id: number; code: number | null; reason: string | null };

export type TrafficEvent =
  | { type: "ExchangeStarted"; id: number; request: HttpRequest }
  | { type: "ExchangeCompleted"; id: number; response: HttpResponse; timing: Timing; protocol: string }
  | { type: "ExchangeFailed"; id: number; error: string }
  | ({ type: "Ws" } & WsEvent);

export interface Device {
  serial: string;
  state: "Online" | "Offline" | "Unauthorized" | "Unknown";
  is_emulator: boolean;
}

export interface AvdInfo {
  name: string;
  device: string | null;
  image_tag: string | null;
  abi: string | null;
  api_level: number | null;
  beholder_ready: boolean;
  running: boolean;
  serial: string | null;
}

export interface SystemImage {
  pkg: string;
  api: number;
  tag: string;
  abi: string;
  installed: boolean;
}

export interface ApkEntry {
  name: string;
  url: string;
  version: string | null;
  env: string | null;
  build: number | null;
  flavor: string | null;
  date: string | null;
  size_bytes: number;
  last_modified: string;
}
