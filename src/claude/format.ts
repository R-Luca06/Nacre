export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function formatCost(usd: number, exact = true): string {
  const v = usd >= 100 ? usd.toFixed(0) : usd >= 10 ? usd.toFixed(1) : usd.toFixed(2);
  return `${exact ? "" : "~"}$${v}`;
}

export type ContextLevel = "normal" | "warn" | "danger";

export const contextLevel = (pct: number, warn: number, danger: number): ContextLevel =>
  pct >= danger ? "danger" : pct >= warn ? "warn" : "normal";
