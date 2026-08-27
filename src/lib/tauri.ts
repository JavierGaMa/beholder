export const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";

export async function listenTraffic(onBatch: (events: unknown[]) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen("traffic-batch", (e) => onBatch(e.payload as unknown[]));
  return unlisten;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return mockInvoke<T>(cmd);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function mockInvoke<T>(cmd: string): Promise<T> {
  switch (cmd) {
    case "adb_status":
      return "/opt/mock/adb" as T;
    case "list_devices":
      return [
        { serial: "emulator-5554", state: "Online", is_emulator: true },
        { serial: "ABC123", state: "Online", is_emulator: false },
      ] as T;
    case "current_proxy":
      return null as T;
    case "format_curl":
      return "curl -X GET 'https://mock.dev/api/x'" as T;
    case "export_har":
      return "{}" as T;
    default:
      return undefined as T;
  }
}
