import { type Profile, normalizeProfiles } from "./profiles";
/**
 * Config defaults and validation. Every invalid value falls back to its default
 * and yields a one-line error, so a typo never breaks the app.
 */

export const defaults = {
  general: {
    language: "auto" as "auto" | "en" | "fr",
    confirm_close: true,
    /** Command to open files clicked in output: `{file}`, `{line}`, `{col}`. Empty: default app. */
    editor: "",
    restore_session: true,
    /** Lines of scrollback kept per pane across restarts; 0 disables. */
    restore_scrollback: 1000,
  },
  shell: {
    program: "",
    integration: true,
    args: [] as string[],
    cwd: "~",
    env: {} as Record<string, string>,
  },
  font: {
    family: "JetBrains Mono",
    size: 13,
    line_height: 1.2,
    letter_spacing: 0,
    ligatures: false,
  },
  theme: {
    mode: "dark" as "dark" | "light" | "system",
    dark: "Nacre",
    light: "Nacre Light",
    /** Tabs and bars follow this theme; empty follows the terminal theme. */
    ui: "",
  },
  cursor: {
    style: "block" as "block" | "bar" | "underline",
    blink: true,
  },
  window: {
    padding: 8,
    dim_inactive: 0.3,
    opacity: 1,
    blur: false,
  },
  terminal: {
    scrollback: 10000,
    option_as_meta: "left" as "none" | "left" | "right" | "both",
    copy_on_select: false,
    paste_warning: true,
    bell: "visual" as "none" | "visual" | "sound" | "notify",
    prompt_marks: true,
    /** Characters that end a word on double-click; URLs, paths and emails stay whole. */
    word_separators: " ()[]{}',\"`<>|;",
    block_separators: false,
    /** Notify when a command running this many seconds ends out of sight; 0 disables. */
    notify_after: 10,
  },
  statusbar: {
    enabled: true,
    position: "bottom" as "bottom" | "top",
    scope: "window" as "window" | "pane",
    style: "minimal" as "minimal" | "simple" | "powerline" | "pills",
    left: ["cwd", "git"],
    center: [] as string[],
    right: ["process", "claude", "time"],
    time_format: "24h" as "24h" | "24h-seconds" | "12h",
    custom: [] as CustomSegment[],
  },
  highlight: [] as HighlightRule[],
  triggers: [] as TriggerRule[],
  claude: {
    context_warn: 60,
    context_danger: 80,
    /** Warn once per session above this, before auto-compaction. */
    context_alert: 85,
    notify: true,
    sound: false,
    dock_badge: true,
  },
  ai: {
    provider: "claude-code" as "claude-code" | "api",
    model: "haiku",
    chat_model: "sonnet",
    claude_path: "",
    /** Ask for a fix automatically after a failed command. */
    auto_fix: false,
  },
  /** name → command; `{{param}}` or `{{param:default}}` are asked when used. */
  snippets: {} as Record<string, string>,
  plugins: {
    /** Plugin names (file or folder name) that stay off. */
    disabled: [] as string[],
  },
  profiles: {} as Record<string, Profile>,
  keys: {} as Record<string, string | string[]>,
};

export interface HighlightRule {
  regex: string;
  /** ANSI color name (red, yellow…) or #hex. */
  color?: string;
  background?: string;
}

export interface TriggerRule {
  regex: string;
  action: "notify" | "sound" | "command" | "mark" | "plugin";
  /** For `command`: run in the background; `$1`… are the regex groups. */
  command?: string;
  /** For plugins. */
  run?: (match: string[], line: string, paneId: string) => void;
}

export interface CustomSegment {
  name: string;
  command: string;
  /** Seconds between runs. */
  interval: number;
  /** Regexes on the output that color the segment. */
  warn?: string;
  danger?: string;
  /** Command sent to the active pane on click. */
  click?: string;
}

export type Config = typeof defaults;

type Rule = { enum?: readonly string[]; min?: number; max?: number; int?: boolean };

const rules: Record<string, Rule> = {
  "general.language": { enum: ["auto", "en", "fr"] },
  "general.restore_scrollback": { min: 0, max: 100000, int: true },
  "font.size": { min: 6, max: 72 },
  "font.line_height": { min: 0.8, max: 3 },
  "font.letter_spacing": { min: -5, max: 20 },
  "theme.mode": { enum: ["dark", "light", "system"] },
  "cursor.style": { enum: ["block", "bar", "underline"] },
  "window.padding": { min: 0, max: 64 },
  "window.dim_inactive": { min: 0, max: 0.9 },
  "window.opacity": { min: 0.2, max: 1 },
  "terminal.scrollback": { min: 0, max: 1_000_000, int: true },
  "terminal.option_as_meta": { enum: ["none", "left", "right", "both"] },
  "terminal.bell": { enum: ["none", "visual", "sound", "notify"] },
  "terminal.notify_after": { min: 0, max: 86400 },
  "claude.context_warn": { min: 1, max: 100 },
  "claude.context_danger": { min: 1, max: 100 },
  "claude.context_alert": { min: 1, max: 100 },
  "ai.provider": { enum: ["claude-code", "api"] },
  "statusbar.position": { enum: ["bottom", "top"] },
  "statusbar.scope": { enum: ["window", "pane"] },
  "statusbar.style": { enum: ["minimal", "simple", "powerline", "pills"] },
  "statusbar.time_format": { enum: ["24h", "24h-seconds", "12h"] },
};

/** Arrays of tables, validated item by item. */
const validRegex = (v: unknown, at: string, errors: string[]): string | null => {
  if (typeof v !== "string" || !v) {
    errors.push(`${at}.regex: required`);
    return null;
  }
  try {
    new RegExp(v);
    return v;
  } catch {
    errors.push(`${at}.regex: invalid regex`);
    return null;
  }
};

const TABLE_LISTS: Record<
  string,
  (item: Record<string, unknown>, at: string, errors: string[]) => unknown
> = {
  highlight: (item, at, errors) => {
    const regex = validRegex(item.regex, at, errors);
    if (!regex) return null;
    const str = (k: string) => (typeof item[k] === "string" ? (item[k] as string) : undefined);
    if (!str("color") && !str("background")) {
      errors.push(`${at}: set color or background`);
      return null;
    }
    return { regex, color: str("color"), background: str("background") };
  },
  triggers: (item, at, errors) => {
    const regex = validRegex(item.regex, at, errors);
    if (!regex) return null;
    const actions = ["notify", "sound", "command", "mark"];
    if (!actions.includes(item.action as string)) {
      errors.push(`${at}.action: use one of ${actions.join(", ")}`);
      return null;
    }
    if (item.action === "command" && typeof item.command !== "string") {
      errors.push(`${at}.command: required for action = "command"`);
      return null;
    }
    return { regex, action: item.action, command: item.command };
  },
  "statusbar.custom": (item, at, errors) => {
    if (typeof item.name !== "string" || !item.name) {
      errors.push(`${at}.name: required`);
      return null;
    }
    if (typeof item.command !== "string" || !item.command) {
      errors.push(`${at}.command: required`);
      return null;
    }
    const interval = typeof item.interval === "number" && item.interval >= 1 ? item.interval : 10;
    const regex = (k: "warn" | "danger") => {
      const v = item[k];
      if (v === undefined) return undefined;
      try {
        new RegExp(String(v));
        return String(v);
      } catch {
        errors.push(`${at}.${k}: invalid regex`);
        return undefined;
      }
    };
    return {
      name: item.name,
      command: item.command,
      interval,
      warn: regex("warn"),
      danger: regex("danger"),
      click: typeof item.click === "string" ? item.click : undefined,
    };
  },
};

/** Sections whose keys are free-form; values are checked for type only. */
const MAPS: Record<string, (v: unknown) => boolean> = {
  snippets: (v) => typeof v === "string",
  "shell.env": (v) => typeof v === "string",
  keys: (v) => typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string")),
};

export const enumOptions = (path: string) => rules[path]?.enum;

const kind = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

function check(path: string, def: unknown, value: unknown, errors: string[]): unknown {
  if (path === "profiles") return normalizeProfiles(value, errors);
  if (value === undefined) return def;
  const listCheck = TABLE_LISTS[path];
  if (listCheck) {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected a list of tables`);
      return def;
    }
    return value
      .map((item, i) =>
        kind(item) === "object"
          ? listCheck(item as Record<string, unknown>, `${path}[${i}]`, errors)
          : (errors.push(`${path}[${i}]: expected a table`), null),
      )
      .filter((x) => x !== null);
  }
  const mapCheck = MAPS[path];
  if (mapCheck) {
    if (kind(value) !== "object") {
      errors.push(`${path}: expected a table`);
      return def;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as object)) {
      if (mapCheck(v)) out[k] = v;
      else errors.push(`${path}.${k}: invalid value`);
    }
    return out;
  }
  if (kind(def) === "object") {
    if (kind(value) !== "object") {
      errors.push(`${path}: expected a table`);
      return def;
    }
    const out: Record<string, unknown> = {};
    const d = def as Record<string, unknown>;
    const v = value as Record<string, unknown>;
    for (const key of Object.keys(d)) {
      out[key] = check(path ? `${path}.${key}` : key, d[key], v[key], errors);
    }
    for (const key of Object.keys(v)) {
      if (!(key in d)) errors.push(`${path ? `${path}.` : ""}${key}: unknown setting`);
    }
    return out;
  }
  if (kind(def) !== kind(value)) {
    errors.push(`${path}: expected ${kind(def)}, using ${JSON.stringify(def)}`);
    return def;
  }
  if (kind(def) === "array") {
    const items = value as unknown[];
    const itemKind = kind((def as unknown[])[0] ?? "");
    if (!items.every((i) => kind(i) === itemKind)) {
      errors.push(`${path}: expected a list of ${itemKind}s`);
      return def;
    }
    return items;
  }
  const rule = rules[path];
  if (rule?.enum && !rule.enum.includes(value as string)) {
    errors.push(`${path}: use one of ${rule.enum.join(", ")}`);
    return def;
  }
  if (typeof value === "number" && rule) {
    if (rule.int && !Number.isInteger(value)) {
      errors.push(`${path}: expected a whole number`);
      return def;
    }
    if (
      (rule.min !== undefined && value < rule.min) ||
      (rule.max !== undefined && value > rule.max)
    ) {
      errors.push(`${path}: must be between ${rule.min} and ${rule.max}`);
      return def;
    }
  }
  return value;
}

export function normalizeConfig(raw: unknown): { config: Config; errors: string[] } {
  const errors: string[] = [];
  const config = check("", defaults, raw ?? {}, errors) as Config;
  return { config, errors };
}
