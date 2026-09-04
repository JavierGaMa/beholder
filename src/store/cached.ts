export type CachedStatus = "idle" | "loading" | "ready" | "error";

export function errorText(e: unknown): string {
  return String(e).replace(/^Error: /, "");
}

export function isFresh(lastFetched: number | null, ttlMs: number): boolean {
  return lastFetched != null && Date.now() - lastFetched < ttlMs;
}
