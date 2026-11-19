export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const at = t.indexOf(q);
  if (at !== -1) {
    let score = 100 - Math.min(at, 40);
    if (at === 0) score += 40;
    if (q.length === t.length) score += 20;
    return score;
  }
  let from = 0;
  let prev = -2;
  let first = -1;
  let run = 0;
  let bestRun = 0;
  for (let i = 0; i < q.length; i++) {
    const found = t.indexOf(q[i], from);
    if (found === -1) return null;
    if (first === -1) first = found;
    run = found === prev + 1 ? run + 1 : 0;
    if (run > bestRun) bestRun = run;
    prev = found;
    from = found + 1;
  }
  return 20 + bestRun * 4 - (prev - first + 1 - q.length);
}
