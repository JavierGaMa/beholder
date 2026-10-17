import type { MetroStatus } from "../../store/traffic";
import type { RnVariantsInfo } from "../../queries/buildrun";

export const NO_FLAVOR = "(no flavor)";

export const INSTALL_UNINSTALLS_NOTE =
  "installs replace the app on the device — the variant is uninstalled first, so app data is cleared";

export type WarningKind = "warn" | "danger";

export interface BuildrunWarning {
  id: string;
  kind: WarningKind;
  text: string;
}

export function buildrunWarnings(info: RnVariantsInfo | null): BuildrunWarning[] {
  if (!info) return [];
  const warnings: BuildrunWarning[] = [];
  if (info.duplicateIds.length > 0) {
    warnings.push({
      id: "duplicate-ids",
      kind: "danger",
      text: `flavors ${formatList(info.duplicateIds)} build the same package id — installing one uninstalls the other`,
    });
  }
  if (info.flavorIds.some((f) => f.effective === null)) {
    warnings.push({
      id: "unknown-app-id",
      kind: "warn",
      text: "base applicationId not found in the gradle file — per-flavor package ids are unknown and Reload is disabled for those flavors",
    });
  }
  return warnings;
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export interface ReloadTarget {
  key: string;
  label: string;
  pkg: string | null;
}

export function reloadTargets(info: RnVariantsInfo | null): ReloadTarget[] {
  if (!info) return [];
  const targets: ReloadTarget[] = [];
  if (info.applicationId) {
    const label = info.flavors.length === 0 ? "app" : NO_FLAVOR;
    targets.push({ key: "base", label, pkg: info.applicationId });
  }
  for (const entry of info.flavorIds) {
    targets.push({
      key: `flavor:${entry.flavor}`,
      label: entry.flavor,
      pkg: entry.effective,
    });
  }
  return targets;
}

export function pickDefaultSerial(
  targetSerial: string | null,
  runningSerials: string[],
): string {
  if (targetSerial && runningSerials.includes(targetSerial)) return targetSerial;
  return runningSerials[0] ?? "";
}

export function assembleTaskName(flavor: string | null, buildType: string): string {
  const flavorPart = flavor ? flavor.charAt(0).toUpperCase() + flavor.slice(1) : "";
  const typePart = buildType.charAt(0).toUpperCase() + buildType.slice(1);
  return `assemble${flavorPart}${typePart}`;
}

export interface MetroPanelState {
  label: string;
  tone: "muted" | "ok" | "warn" | "danger";
}

export function metroPanelState(
  status: MetroStatus | null,
  starting: boolean,
): MetroPanelState {
  if (status?.detected) return { label: `running on :${status.port}`, tone: "ok" };
  if (starting) return { label: "compiling — first start takes a while", tone: "warn" };
  return { label: "not running", tone: "muted" };
}
