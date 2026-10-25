/** A normalized key combo, e.g. `cmd+shift+t`. Sequences (chords) are space-separated. */
export type Combo = string;

const MOD_ORDER = ["ctrl", "alt", "shift", "cmd"] as const;
type Mod = (typeof MOD_ORDER)[number];

const MOD_ALIASES: Record<string, Mod> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  opt: "alt",
  option: "alt",
  shift: "shift",
  cmd: "cmd",
  command: "cmd",
  meta: "cmd",
  super: "cmd",
};

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  del: "delete",
  space: " ",
  plus: "+",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  pgup: "pageup",
  pgdown: "pagedown",
};

const CODE_KEYS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Space: " ",
  NumpadAdd: "+",
  NumpadSubtract: "-",
  NumpadEnter: "enter",
};

function normalizeKey(key: string): string {
  const k = key.toLowerCase();
  return KEY_ALIASES[k] ?? k;
}

/** Parses one step of a binding (`Cmd+Shift+[`) into canonical form. Returns null if invalid. */
export function parseStep(input: string): Combo | null {
  const raw = input.trim();
  if (!raw) return null;
  // `cmd++` means cmd and the plus key.
  const parts = raw.endsWith("++") ? [...raw.slice(0, -2).split("+"), "+"] : raw.split("+");
  const mods = new Set<Mod>();
  let key: string | null = null;
  for (const part of parts) {
    const p = part.trim().toLowerCase();
    if (!p) return null;
    const mod = MOD_ALIASES[p];
    if (mod) {
      mods.add(mod);
    } else {
      if (key !== null) return null;
      key = normalizeKey(p);
    }
  }
  if (key === null) return null;
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join("+");
}

/** Parses a full binding, possibly a chord sequence (`ctrl+a d`). */
export function parseCombo(input: string): Combo | null {
  const steps = input.trim().split(/\s+/).map(parseStep);
  if (steps.length === 0 || steps.some((s) => s === null)) return null;
  return steps.join(" ");
}

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "CapsLock", "Fn", "OS"]);

export function isModifierOnly(e: KeyLike): boolean {
  return MODIFIER_KEYS.has(e.key);
}

function modsOf(e: KeyLike): string[] {
  const m: string[] = [];
  if (e.ctrlKey) m.push("ctrl");
  if (e.altKey) m.push("alt");
  if (e.shiftKey) m.push("shift");
  if (e.metaKey) m.push("cmd");
  return m;
}

function codeKey(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad") && /\d$/.test(code)) return code.slice(6);
  return CODE_KEYS[code] ?? null;
}

/**
 * Candidate combos for a key event: the produced character first (layout-aware),
 * then the physical key (stable under Shift/Option and on non-US layouts).
 */
export function eventCombos(e: KeyLike): Combo[] {
  if (isModifierOnly(e)) return [];
  const mods = modsOf(e);
  const out: Combo[] = [];
  const key = normalizeKey(e.key === "Dead" ? "" : e.key);
  if (key) out.push([...mods, key].join("+"));
  const phys = codeKey(e.code);
  if (phys && phys !== key) out.push([...mods, phys].join("+"));
  return out;
}

const DISPLAY: Record<string, string> = {
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
  cmd: "⌘",
  enter: "↩",
  escape: "⎋",
  backspace: "⌫",
  delete: "⌦",
  tab: "⇥",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  pageup: "⇞",
  pagedown: "⇟",
  home: "↖",
  end: "↘",
  " ": "Space",
};

/** `cmd+shift+t` → `⇧⌘T` (macOS order: ⌃⌥⇧⌘). */
export function formatCombo(combo: Combo): string {
  return combo
    .split(" ")
    .map((step) => {
      const parts = step.endsWith("++") ? [...step.slice(0, -2).split("+"), "+"] : step.split("+");
      return parts.map((p) => DISPLAY[p] ?? (p.length === 1 ? p.toUpperCase() : cap(p))).join("");
    })
    .join(" ");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
