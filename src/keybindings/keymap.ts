import { type Combo, type KeyLike, eventCombos, isModifierOnly, parseCombo } from "./combo";

export type Bindings = Record<string, Combo[]>;

export interface Conflict {
  combo: Combo;
  actions: string[];
}

/** Applies user overrides (`action → combo | combo[] | ""`) on top of defaults. */
export function mergeBindings(
  defaults: Bindings,
  overrides: Record<string, string | string[]> | undefined,
): { bindings: Bindings; errors: string[] } {
  const bindings: Bindings = { ...defaults };
  const errors: string[] = [];
  for (const [action, value] of Object.entries(overrides ?? {})) {
    const list = Array.isArray(value) ? value : [value];
    const parsed: Combo[] = [];
    for (const raw of list) {
      if (raw.trim() === "") continue;
      const c = parseCombo(raw);
      if (c) parsed.push(c);
      else errors.push(`keys.${action}: "${raw}" is not a valid shortcut`);
    }
    bindings[action] = parsed;
  }
  return { bindings, errors };
}

/** Combos bound to several actions, and combos that shadow a longer chord. */
export function findConflicts(bindings: Bindings): Conflict[] {
  const byCombo = new Map<Combo, string[]>();
  for (const [action, combos] of Object.entries(bindings)) {
    for (const c of combos) {
      const list = byCombo.get(c) ?? [];
      if (!list.includes(action)) list.push(action);
      byCombo.set(c, list);
    }
  }
  const conflicts: Conflict[] = [];
  for (const [combo, actions] of byCombo) {
    if (actions.length > 1) conflicts.push({ combo, actions });
  }
  for (const [combo, actions] of byCombo) {
    for (const [other, otherActions] of byCombo) {
      if (other !== combo && other.startsWith(combo + " ")) {
        conflicts.push({ combo, actions: [...actions, ...otherActions] });
      }
    }
  }
  return conflicts;
}

export type KeyResult =
  | { kind: "none" }
  | { kind: "pending" }
  | { kind: "cancelled" }
  | { kind: "action"; action: string };

const CHORD_TIMEOUT = 2000;

export class Keymap {
  private byCombo = new Map<Combo, string>();
  private prefixes = new Set<Combo>();
  private pending: Combo | null = null;
  private pendingAt = 0;

  constructor(bindings: Bindings) {
    for (const [action, combos] of Object.entries(bindings)) {
      for (const combo of combos) {
        if (!this.byCombo.has(combo)) this.byCombo.set(combo, action);
        const steps = combo.split(" ");
        for (let i = 1; i < steps.length; i++) this.prefixes.add(steps.slice(0, i).join(" "));
      }
    }
  }

  get isPending(): boolean {
    return this.pending !== null;
  }

  handle(e: KeyLike, now = Date.now()): KeyResult {
    if (isModifierOnly(e)) return { kind: this.pending ? "pending" : "none" };
    if (this.pending && now - this.pendingAt > CHORD_TIMEOUT) this.pending = null;
    const candidates = eventCombos(e);
    for (const c of candidates) {
      const seq = this.pending ? `${this.pending} ${c}` : c;
      const action = this.byCombo.get(seq);
      if (action) {
        this.pending = null;
        return { kind: "action", action };
      }
    }
    for (const c of candidates) {
      const seq = this.pending ? `${this.pending} ${c}` : c;
      if (this.prefixes.has(seq)) {
        this.pending = seq;
        this.pendingAt = now;
        return { kind: "pending" };
      }
    }
    if (this.pending) {
      this.pending = null;
      return { kind: "cancelled" };
    }
    return { kind: "none" };
  }

  reset() {
    this.pending = null;
  }
}
