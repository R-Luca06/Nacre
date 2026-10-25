import { actionById, defaultBindings } from "../app/actions";
import { type Combo, parseCombo } from "./combo";
import { type Bindings, Keymap, mergeBindings } from "./keymap";

let bindings: Bindings = {};
let keymap = new Keymap({});
const listeners = new Set<() => void>();

function normalized(): Bindings {
  const out: Bindings = {};
  for (const [id, keys] of Object.entries(defaultBindings())) {
    out[id] = keys.map((k) => parseCombo(k)).filter((k): k is Combo => k !== null);
  }
  return out;
}

/** Rebuilds the keymap from defaults and `[keys]` overrides; returns config errors. */
export function rebuildKeymap(overrides: Record<string, string | string[]>): string[] {
  const merged = mergeBindings(normalized(), overrides);
  const errors = merged.errors;
  for (const id of Object.keys(overrides)) {
    if (!actionById.has(id)) errors.push(`keys.${id}: unknown action`);
  }
  bindings = merged.bindings;
  keymap = new Keymap(bindings);
  listeners.forEach((l) => l());
  return errors;
}

export const currentBindings = () => bindings;
export const bindingsFor = (actionId: string): Combo[] => bindings[actionId] ?? [];

export function onBindingsChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let lastFired = { id: "", at: 0 };

/** Runs an action, ignoring a duplicate trigger from the native menu. */
export function runAction(id: string, source: "key" | "menu" | "palette" = "key"): unknown {
  const now = performance.now();
  if (source === "menu" && lastFired.id === id && now - lastFired.at < 150) return undefined;
  lastFired = { id, at: now };
  return actionById.get(id)?.run();
}

/** Returns true when the event was consumed by the app. */
export function handleKeyEvent(e: KeyboardEvent): boolean {
  const r = keymap.handle(e);
  if (r.kind === "pending" || r.kind === "cancelled") return true;
  if (r.kind !== "action") return false;
  return runAction(r.action) !== false;
}

export const isChordPending = () => keymap.isPending;
