export interface Header {
  name: string;
  value: string;
}

export interface BodyCapture {
  mime: string | null;
  size: number;
  wire_size?: number | null;
  truncated: boolean;
  text: string;
  is_binary: boolean;
  data_b64?: string | null;
}

export interface HttpRequest {
  method: string;
  url: string;
  host: string;
  path: string;
  headers: Header[];
  body?: BodyCapture | null;
  started_at: number;
  routed?: RoutedTo | null;
}

export interface RoutedTo {
  route_id: string;
  target: string;
}

export interface RouteStatus {
  key: string;
  id: string;
  path_prefix: string;
  host: string | null;
  target: string;
  enabled: boolean;
}

export interface RouteFileStatus {
  path: string;
  name: string;
  error: string | null;
  routes: RouteStatus[];
}

export type RouteHealth = "up" | "down";

export interface DiscoveredFile {
  id: string;
  label: string;
  path: string;
  hint: string | null;
  routes: number;
  up: number;
  error: string | null;
}

export interface DiscoveryResult {
  name: string;
  address: string;
  files: DiscoveredFile[];
}

export interface DiscoverFailure {
  kind: "invalidAddress" | "unreachable" | "invalidResponse";
  message: string;
}

export interface RouteConfigFailure {
  kind: "invalidFile" | "config";
  message: string;
}

export interface RouteFilesUpdate {
  files: string[];
  name: string;
  reset: string[];
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
