export function downloadPct(downloaded: number, total: number | null | undefined): number {
  if (!total || total <= 0 || downloaded <= 0) return 0;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

export function bannerTitle(version: string): string {
  return `Beholder ${version} available`;
}

export function notesLine(notes: string | null | undefined, maxChars = 120): string | null {
  if (!notes) return null;
  const collapsed = notes.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars - 1).trimEnd()}…`;
}
