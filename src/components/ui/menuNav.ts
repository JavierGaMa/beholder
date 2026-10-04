export function nextMenuIndex(key: string, current: number, enabled: readonly boolean[]): number {
  const n = enabled.length;
  if (n === 0) return -1;
  const first = enabled.indexOf(true);
  const last = enabled.lastIndexOf(true);
  if (key === "Home") return first === -1 ? current : first;
  if (key === "End") return first === -1 ? current : last;
  const dir = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
  if (dir === 0 || first === -1) return current;
  if (current < 0) return dir === 1 ? first : last;
  let idx = current;
  for (let step = 0; step < n; step++) {
    idx = (idx + dir + n) % n;
    if (enabled[idx]) return idx;
  }
  return current;
}
