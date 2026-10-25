import { type Config, defaults, enumOptions } from "./schema";

const fmt = (v: unknown): string => {
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(fmt).join(", ")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v);
    return entries.length ? `{ ${entries.map(([k, x]) => `${k} = ${fmt(x)}`).join(", ")} }` : "{}";
  }
  return String(v);
};

const quoteKey = (k: string) => (/^[\w-]+$/.test(k) ? k : JSON.stringify(k));

/** The commented config.toml written on first launch. Every line shows a default. */
export function renderTemplate(
  keyDefaults: Record<string, string[]>,
  c: Config = defaults,
): string {
  const out: string[] = [
    "# Nacre. Uncomment a line to change it; saving applies it.",
    "# Docs: docs/config.md",
    "",
  ];
  for (const [section, values] of Object.entries(c)) {
    if (section === "keys") continue;
    out.push(`[${section}]`);
    for (const [key, value] of Object.entries(values as object)) {
      if (section === "statusbar" && key === "custom") continue;
      const opts = enumOptions(`${section}.${key}`);
      const line = `# ${quoteKey(key)} = ${fmt(value)}`;
      out.push(opts ? `${line.padEnd(36)} # ${opts.join(" | ")}` : line);
    }
    out.push("");
  }
  out.push('# Script segments: add "custom:<name>" to left/center/right.');
  out.push("# [[statusbar.custom]]");
  out.push('#   name = "load"');
  out.push('#   command = "sysctl -n vm.loadavg"');
  out.push("#   interval = 10");
  out.push("");
  out.push("[keys]");
  out.push('# One shortcut or a list. "" unbinds. Chords: "ctrl+a d".');
  for (const [action, keys] of Object.entries(keyDefaults)) {
    if (keys.length) out.push(`# ${quoteKey(action)} = ${fmt(keys.length === 1 ? keys[0] : keys)}`);
  }
  out.push("");
  return out.join("\n");
}
