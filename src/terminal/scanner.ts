import type { IDecoration, Terminal } from "@xterm/xterm";
import type { HighlightRule, TriggerRule } from "../config/schema";
import { ANSI_NAMES } from "../themes/types";

export interface ScanRules {
  highlight: HighlightRule[];
  triggers: TriggerRule[];
  maskSecrets?: boolean;
}

/** Tokens that should not sit in plain sight on screen or in screenshots. */
export const SECRET_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

export function findSecrets(line: string): [number, number][] {
  const out: [number, number][] = [];
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) {
      const s = m.index!;
      const e = s + m[0].length;
      if (!out.some(([a, b]) => s < b && e > a)) out.push([s, e]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Resolves `red`, `brightBlue` or `#hex` against the current theme. */
export function resolveColor(c: string | undefined, palette: string[]): string | undefined {
  if (!c) return undefined;
  if (c.startsWith("#")) return c;
  const i = ANSI_NAMES.indexOf(c as (typeof ANSI_NAMES)[number]);
  return i >= 0 ? palette[i] : undefined;
}

const MAX_LINES_PER_PASS = 400;
const MAX_DECORATIONS = 2000;

/** Applies highlight rules and fires triggers on lines as they are written. */
export class LineScanner {
  private next = 0;
  private decorations: IDecoration[] = [];
  private compiled: { h: (HighlightRule & { re: RegExp })[]; t: (TriggerRule & { re: RegExp })[] } =
    { h: [], t: [] };
  private lastFired = new Map<number, number>();

  constructor(
    private term: Terminal,
    private palette: () => string[],
    private onTrigger: (rule: TriggerRule, match: RegExpMatchArray, line: string) => void,
  ) {
    term.onWriteParsed(() => this.scan());
  }

  private mask = false;

  setRules(rules: ScanRules) {
    this.mask = !!rules.maskSecrets;
    this.compiled = {
      h: rules.highlight.map((r) => ({ ...r, re: new RegExp(r.regex, "g") })),
      t: rules.triggers.map((r) => ({ ...r, re: new RegExp(r.regex) })),
    };
  }

  private scan() {
    if (!this.compiled.h.length && !this.compiled.t.length && !this.mask) return;
    const buf = this.term.buffer.active;
    if (buf.type === "alternate") return;
    // Lines above the cursor are complete; the cursor line may still change.
    const cursor = buf.baseY + buf.cursorY;
    if (this.next > cursor) this.next = cursor;
    const from = Math.max(this.next, cursor - MAX_LINES_PER_PASS);
    for (let y = from; y < cursor; y++) {
      const line = buf.getLine(y)?.translateToString(true) ?? "";
      if (line) this.apply(y, cursor, line);
    }
    this.next = cursor;
  }

  private apply(y: number, cursor: number, line: string) {
    const palette = this.palette();
    if (this.mask) {
      for (const [start, end] of findSecrets(line)) {
        const marker = this.term.registerMarker(y - cursor);
        if (!marker) continue;
        // Keep a short prefix so the kind of key stays recognizable.
        const keep = Math.min(6, end - start - 4);
        const d = this.term.registerDecoration({
          marker,
          x: start + keep,
          width: end - start - keep,
          backgroundColor: palette[8],
          foregroundColor: palette[8],
          layer: "top",
        });
        if (d) this.decorations.push(d);
      }
    }
    for (const h of this.compiled.h) {
      h.re.lastIndex = 0;
      for (const m of line.matchAll(h.re)) {
        if (!m[0]) continue;
        const marker = this.term.registerMarker(y - cursor);
        if (!marker) continue;
        const d = this.term.registerDecoration({
          marker,
          x: m.index!,
          width: m[0].length,
          foregroundColor: resolveColor(h.color, palette),
          backgroundColor: resolveColor(h.background, palette),
          layer: "top",
        });
        if (d) this.decorations.push(d);
      }
    }
    while (this.decorations.length > MAX_DECORATIONS) this.decorations.shift()?.dispose();
    const now = Date.now();
    this.compiled.t.forEach((tr, i) => {
      const m = line.match(tr.re);
      if (!m) return;
      if (now - (this.lastFired.get(i) ?? 0) < 2000) return;
      this.lastFired.set(i, now);
      if (tr.action === "mark") {
        const marker = this.term.registerMarker(y - cursor);
        if (marker) {
          this.term.registerDecoration({
            marker,
            overviewRulerOptions: { color: palette[3] ?? "#e5c07b", position: "right" },
          });
        }
      }
      this.onTrigger(tr, m, line);
    });
  }
}
