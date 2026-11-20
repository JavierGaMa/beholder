import type { Timing } from "../../store/types";

export interface Phase {
  label: string;
  ms: number;
}

export function timingPhases(t: Timing): Phase[] {
  const phases: Phase[] = [];
  if (t.ttfb_ms != null && t.ttfb_ms > 0) phases.push({ label: "TTFB", ms: t.ttfb_ms });
  if (t.download_ms != null && t.download_ms > 0) phases.push({ label: "Download", ms: t.download_ms });
  const measured = phases.reduce((sum, p) => sum + p.ms, 0);
  if (t.total_ms != null && t.total_ms > measured) phases.push({ label: "Other", ms: t.total_ms - measured });
  return phases;
}
