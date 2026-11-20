import type { CaptureCheckT } from "../../queries/captureHealth";
import type { MetroStatus } from "../../store/traffic";

export type HealthTone = "muted" | "warn" | "danger";

export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function healthSummary({
  checks,
  unknown,
  capturePort,
  metro,
}: {
  checks: CaptureCheckT[];
  unknown: boolean;
  capturePort: number | null;
  metro: MetroStatus | null;
}): { text: string; tone: HealthTone } {
  const parts: string[] = [];
  if (capturePort != null) parts.push(`Proxy :${capturePort}`);
  if (metro?.detected) parts.push(`Metro :${metro.port}`);

  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  let tone: HealthTone = "muted";
  let status: string;
  if (unknown || checks.length === 0) {
    status = "checking health";
  } else if (fails > 0) {
    status = `${plural(fails, "check")} failing`;
    tone = "danger";
  } else if (warns > 0) {
    status = plural(warns, "warning");
    tone = "warn";
  } else {
    status = "all checks pass";
  }
  parts.push(status);
  const text = parts.join(", ");
  return { text: text.charAt(0).toUpperCase() + text.slice(1), tone };
}
