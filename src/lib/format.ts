export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMs(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return `${n} ms`;
  return `${(n / 1000).toFixed(2)} s`;
}

export function formatTime(unixMs: number): string {
  const d = new Date(unixMs);
  return d.toLocaleTimeString([], { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

export function statusClass(status: number | null | undefined): "ok" | "warn" | "danger" | "muted" {
  if (status == null) return "muted";
  if (status < 300) return "ok";
  if (status < 400) return "warn";
  return "danger";
}

export function methodClass(method: string): string {
  switch (method) {
    case "GET":
      return "text-accent";
    case "POST":
      return "text-ok";
    case "PUT":
    case "PATCH":
      return "text-warn";
    case "DELETE":
      return "text-danger";
    default:
      return "text-txt";
  }
}
