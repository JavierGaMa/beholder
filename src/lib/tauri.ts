import { createRoutesMock, ROUTE_MOCK_COMMANDS } from "./mock";

export const isTauri =
  typeof window !== "undefined" &&
  typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";

export async function listenTraffic(onBatch: (events: unknown[]) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen("traffic-batch", (e) => onBatch(e.payload as unknown[]));
  return unlisten;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return mockInvoke<T>(cmd, args);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function pickRouteFile(): Promise<string | null> {
  if (!isTauri) return routesMock.pickFile();
  const { open } = await import("@tauri-apps/plugin-dialog");
  const chosen = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Route file", extensions: ["json"] }],
  });
  return typeof chosen === "string" ? chosen : null;
}

const routesMock = createRoutesMock(typeof window === "undefined" ? "" : (window.location?.search ?? ""));

async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (ROUTE_MOCK_COMMANDS.includes(cmd)) return routesMock.invoke(cmd, args) as Promise<T>;
  switch (cmd) {
    case "adb_status":
      return "/opt/mock/adb" as T;
    case "list_devices":
      return [
        { serial: "emulator-5554", state: "Online", is_emulator: true, model: "sdk gphone64 arm64" },
        { serial: "ABC123", state: "Online", is_emulator: false, model: "SM S911B" },
      ] as T;
    case "probe_device":
      return {
        probe: {
          serial: String(args?.serial ?? "ABC123"),
          model: "SM-S911B",
          android_release: "14",
          sdk: 34,
          is_emulator: false,
          root: "none",
          system_ca_installed: false,
          companion_version: null,
        },
        tiers: [
          { tier: "basic", state: "ready", detail: "Logcat, shell, APK install, plain HTTP and Metro." },
          { tier: "user_ca", state: "action", detail: "Install the certificate in Settings and add the config to your debug build." },
          { tier: "full", state: "locked", detail: "Needs Magisk root. Unlocks HTTPS of any app without pinning and the database viewer." },
        ],
      } as T;
    case "current_proxy":
      return null as T;
    case "format_curl":
      return "curl -X GET 'https://mock.dev/api/x'" as T;
    case "export_har":
      return "{}" as T;
    case "list_avds":
      return [
        { name: "Pixel_10_Pro_XL", device: "pixel_10_pro_xl", image_tag: "google_apis_playstore_ps16k", abi: "arm64-v8a", api_level: 36, beholder_ready: false, running: true },
        { name: "Beholder_Dev", device: "pixel_7", image_tag: "google_apis", abi: "arm64-v8a", api_level: 32, beholder_ready: true, running: false },
      ] as T;
    case "list_images":
      return [
        { pkg: "system-images;android-37;google_apis;arm64-v8a", api: 37, tag: "google_apis", abi: "arm64-v8a", installed: false },
        { pkg: "system-images;android-36;google_apis;arm64-v8a", api: 36, tag: "google_apis", abi: "arm64-v8a", installed: true },
      ] as T;
    case "list_device_profiles":
      return ["pixel_7", "pixel_9_pro", "pixel_10_pro_xl"] as T;
    case "run_host_doctor":
      return [] as T;
    case "preview_shell_env":
      return ["export ANDROID_HOME=\"$HOME/Library/Android/sdk\""] as T;
    case "list_apks":
      return [
        { name: "advisor-v2.0.12-QA-build-2012-release-RN-from-10-07-2026.apk", url: "https://example.dev/advisor-v2.0.12.apk", version: "2.0.12", env: "QA", build: 2012, flavor: "release", date: "10-07-2026", size_bytes: 85689296, last_modified: "Fri, 10 Jul 2026 09:12:44 GMT" },
        { name: "advisor-v0.0.5-PROD-build-5-release-RN-from-07-07-2026.apk", url: "https://example.dev/advisor-v0.0.5-PROD.apk", version: "0.0.5", env: "PROD", build: 5, flavor: "release", date: "07-07-2026", size_bytes: 220145971, last_modified: "Tue, 07 Jul 2026 10:30:00 GMT" },
        { name: "advisor-v0.0.0.1-QA-build-1-automation-RN-from-17-07-2026.apk", url: "https://example.dev/advisor-v0.0.0.1.apk", version: "0.0.0.1", env: "QA", build: 1, flavor: "automation", date: "17-07-2026", size_bytes: 91245184, last_modified: "Fri, 17 Jul 2026 08:00:00 GMT" },
        { name: "advisor-v0.0.4-QA-build-4-release-RN-from-07-07-2026.apk", url: "https://example.dev/advisor-v0.0.4.apk", version: "0.0.4", env: "QA", build: 4, flavor: "release", date: "07-07-2026", size_bytes: 85404672, last_modified: "Mon, 07 Jul 2026 09:12:44 GMT" },
        { name: "advisor-v0.0.0-jdv-QA-build-1-release-RN-from-20-04-2026.apk", url: "https://example.dev/advisor-v0.0.0-jdv.apk", version: "0.0.0", env: "QA", build: 1, flavor: "release", date: "20-04-2026", size_bytes: 83856384, last_modified: "Mon, 20 Apr 2026 16:45:12 GMT" },
      ] as T;
    case "apks_download_dir":
      return { dir: "~/Downloads/beholder-apks" } as T;
    case "list_local_apks":
      return [] as T;
    default:
      return undefined as T;
  }
}
