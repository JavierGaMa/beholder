import type { AvdInfo } from "../../store/types";

export function resolveSelectedAvd(
  avds: AvdInfo[],
  selectedName: string | null,
  targetSerial: string | null,
  targetAvd: string | null,
): AvdInfo | null {
  if (selectedName != null) {
    const explicit = avds.find((a) => a.name === selectedName);
    if (explicit) return explicit;
  }
  const target = avds.find(
    (a) =>
      a.running &&
      ((targetSerial != null && a.serial === targetSerial) ||
        (targetAvd != null && a.name === targetAvd)),
  );
  return target ?? avds[0] ?? null;
}

export function avdSummary(avd: AvdInfo): string {
  return `${avd.device ?? "?"}, API ${avd.api_level ?? "?"}, ${avd.image_tag ?? "?"}`;
}

export interface DoctorSummary {
  passing: number;
  total: number;
  fixCount: number;
}

export function doctorSummary(
  checks: readonly { status: "ok" | "warn" | "fail"; fix: string | null }[],
): DoctorSummary {
  return {
    passing: checks.filter((c) => c.status === "ok").length,
    total: checks.length,
    fixCount: checks.filter((c) => c.fix != null && c.fix !== "reboot").length,
  };
}
