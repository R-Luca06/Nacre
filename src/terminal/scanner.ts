import type { IDecoration, Terminal } from "@xterm/xterm";
import type { HighlightRule, TriggerRule } from "../config/schema";
import { ANSI_NAMES } from "../themes/types";

export interface ScanRules {
  highlight: HighlightRule[];
  triggers: TriggerRule[];
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

  setRules(rules: ScanRules) {
    this.compiled = {
      h: rules.highlight.map((r) => ({ ...r, re: new RegExp(r.regex, "g") })),
      t: rules.triggers.map((r) => ({ ...r, re: new RegExp(r.regex) })),
    };
  }

  private scan() {
    if (!this.compiled.h.length && !this.compiled.t.length) return;
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
