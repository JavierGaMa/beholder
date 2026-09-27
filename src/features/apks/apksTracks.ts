import type { ApkEntry } from "../../store/types";

export interface BuildTrack {
  key: string;
  env: string;
  flavor: string;
  latest: ApkEntry;
  history: ApkEntry[];
}

export function trackKey(env: string, flavor: string): string {
  return `${env}/${flavor}`;
}

function normalizedEnv(env: string | null | undefined): string {
  return env?.toUpperCase() || "UNKNOWN";
}

function normalizedFlavor(flavor: string | null | undefined): string {
  return flavor?.trim() || "default";
}

function byRecencyDesc(a: ApkEntry, b: ApkEntry): number {
  if (a.last_modified !== b.last_modified) {
    return a.last_modified < b.last_modified ? 1 : -1;
  }
  if (a.name !== b.name) return a.name < b.name ? 1 : -1;
  return 0;
}

export function buildTracks(entries: ApkEntry[]): BuildTrack[] {
  const groups = new Map<string, { env: string; flavor: string; entries: ApkEntry[] }>();
  for (const entry of entries) {
    const env = normalizedEnv(entry.env);
    const flavor = normalizedFlavor(entry.flavor);
    const key = trackKey(env, flavor);
    const group = groups.get(key) ?? { env, flavor, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }
  const tracks: BuildTrack[] = [];
  for (const [key, group] of groups) {
    const sorted = [...group.entries].sort(byRecencyDesc);
    tracks.push({
      key,
      env: group.env,
      flavor: group.flavor,
      latest: sorted[0],
      history: sorted.slice(1),
    });
  }
  return tracks.sort((a, b) => {
    if (a.latest.last_modified !== b.latest.last_modified) {
      return a.latest.last_modified < b.latest.last_modified ? 1 : -1;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

export function capTracks(tracks: BuildTrack[], maxEntries: number): BuildTrack[] {
  const capped: BuildTrack[] = [];
  let used = 0;
  for (const track of tracks) {
    if (used >= maxEntries) break;
    const history = track.history.slice(0, maxEntries - used - 1);
    used += 1 + history.length;
    capped.push({ ...track, history });
  }
  return capped;
}

export function formatRelativeLastModified(lastModified: string, now: number): string {
  const at = new Date(lastModified).getTime();
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(at).toISOString().slice(0, 10);
}
