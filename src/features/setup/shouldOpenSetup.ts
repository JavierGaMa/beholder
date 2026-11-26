import type { Device } from "../../store/types";

export function shouldOpenSetup(
  checks: { id: string; status: string }[],
  devices: Device[],
): boolean {
  const failed = checks.filter((c) => c.status === "fail");
  if (failed.length === 0) return false;
  if (failed.some((c) => c.id === "platform_tools")) return true;
  return !devices.some((d) => !d.is_emulator && d.state === "Online");
}
