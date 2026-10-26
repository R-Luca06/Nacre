export type HintKind = "url" | "path" | "hash" | "ip" | "email";

export interface Hint {
  kind: HintKind;
  text: string;
  /** Viewport row and column. */
  row: number;
  col: number;
  label: string;
}

const PATTERNS: [HintKind, RegExp][] = [
  ["url", /\b(?:https?|ftp|file):\/\/[^\s"'<>`)\]]+/g],
  ["email", /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g],
  ["ip", /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g],
  ["path", /(?<![\w/.~-])(?:~|\.{1,2})?\/?(?:[\w.@+-]+\/)+[\w.@+-]+(?::\d+(?::\d+)?)?/g],
  ["hash", /\b[0-9a-f]{7,40}\b/g],
];

const ALPHABET = "asdfghjklqwertyuiopzxcvbnm";

/** Short labels first; two letters once one letter runs out (never a prefix of another). */
export function labels(n: number): string[] {
  if (n <= ALPHABET.length) return ALPHABET.slice(0, n).split("");
  const singles = Math.max(
    0,
    ALPHABET.length - Math.ceil((n - ALPHABET.length) / ALPHABET.length) - 1,
  );
  const out = ALPHABET.slice(0, singles).split("");
  for (const a of ALPHABET.slice(singles)) {
    for (const b of ALPHABET) {
      if (out.length >= n) return out;
      out.push(a + b);
    }
  }
  return out;
}

/** Matches in the given viewport lines; earlier patterns win on overlap. */
export function findHints(lines: string[]): Hint[] {
  const found: Omit<Hint, "label">[] = [];
  lines.forEach((line, row) => {
    const taken: [number, number][] = [];
    for (const [kind, re] of PATTERNS) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        const start = m.index!;
        const end = start + m[0].length;
        if (taken.some(([a, b]) => start < b && end > a)) continue;
        if (kind === "hash" && !/[a-f]/.test(m[0])) continue;
        let text = m[0];
        if (kind === "url") text = text.replace(/[.,;:!?]+$/, "");
        taken.push([start, end]);
        found.push({ kind, text, row, col: start });
      }
    }
  });
  found.sort((a, b) => a.row - b.row || a.col - b.col);
  const ls = labels(found.length);
  return found.map((h, i) => ({ ...h, label: ls[i] }));
}
