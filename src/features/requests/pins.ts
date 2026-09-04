export function togglePinned(pinned: Set<number>, id: number): Set<number> {
  const next = new Set(pinned);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
