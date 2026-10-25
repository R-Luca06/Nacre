/** Subsequence match score; higher is better, null if no match. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const s = text.toLowerCase();
  let score = 0;
  let qi = 0;
  let prev = -2;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] !== q[qi]) continue;
    let bonus = 1;
    if (i === 0 || /[\s\-_./:]/.test(s[i - 1])) bonus += 3;
    if (prev === i - 1) bonus += 2;
    score += bonus;
    prev = i;
    qi++;
  }
  if (qi < q.length) return null;
  return score - s.length * 0.01;
}

export function fuzzyFilter<T>(items: T[], query: string, key: (item: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(query, key(item)) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}
