export interface HostCheckT {
  id: string;
  title: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix: string | null;
}

const ORDER = [
  "install_android_studio",
  "init_sdk_dir",
  "install_cmdline_tools",
  "install_sdk_packages",
] as const;

export function fixPlan(checks: HostCheckT[]): string[] {
  const failing = new Set(
    checks
      .filter((c) => c.status === "fail")
      .map((c) => c.fix)
      .filter((f): f is string => f != null),
  );
  return ORDER.filter((f) => failing.has(f));
}
