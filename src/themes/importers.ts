import { parse as parseToml } from "smol-toml";
import { parseHex, toHex } from "./color";
import type { Theme } from "./types";

type Partial16 = (string | undefined)[];

const hex = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim().replace(/^0x/i, "#");
  const c = parseHex(s.startsWith("#") ? s : `#${s}`);
  return c ? toHex(c) : undefined;
};

function finish(name: string, t: Omit<Partial<Theme>, "ansi"> & { ansi: Partial16 }): Theme {
  const ansi = t.ansi.slice(0, 16);
  if (!t.background || !t.foreground || ansi.filter(Boolean).length < 8) {
    throw new Error(
      "Not enough colors: a background, a foreground and at least 8 ANSI colors are needed.",
    );
  }
  // Missing bright colors reuse the normal ones.
  const full = Array.from({ length: 16 }, (_, i) => ansi[i] ?? ansi[i % 8] ?? t.foreground!);
  return {
    name,
    background: t.background,
    foreground: t.foreground,
    cursor: t.cursor ?? t.foreground,
    cursorText: t.cursorText,
    selection: t.selection ?? full[8],
    selectionText: t.selectionText,
    ansi: full,
  };
}

/** iTerm2 `.itermcolors` (XML plist, float components). */
export function fromITerm(text: string, name: string): Theme {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const root = doc.querySelector("plist > dict");
  if (!root) throw new Error("Not an iTerm2 color file.");
  const colors: Record<string, string> = {};
  const kids = [...root.children];
  for (let i = 0; i < kids.length - 1; i++) {
    if (kids[i].tagName !== "key" || kids[i + 1].tagName !== "dict") continue;
    const comp: Record<string, number> = {};
    const d = [...kids[i + 1].children];
    for (let j = 0; j < d.length - 1; j += 2)
      comp[d[j].textContent ?? ""] = Number(d[j + 1].textContent);
    const ch = (k: string) => Math.round((comp[`${k} Component`] ?? 0) * 255);
    colors[kids[i].textContent ?? ""] = toHex([ch("Red"), ch("Green"), ch("Blue")]);
  }
  return finish(name, {
    background: colors["Background Color"],
    foreground: colors["Foreground Color"],
    cursor: colors["Cursor Color"],
    cursorText: colors["Cursor Text Color"],
    selection: colors["Selection Color"],
    selectionText: colors["Selected Text Color"],
    ansi: Array.from({ length: 16 }, (_, i) => colors[`Ansi ${i} Color`]),
  });
}

/** Base16 YAML scheme (`base00`…`base0F`). */
export function fromBase16(text: string, fallbackName: string): Theme {
  const b: Record<string, string> = {};
  let name = fallbackName;
  for (const line of text.split("\n")) {
    const m = /^\s*(base0[0-9A-Fa-f]|scheme|name)\s*:\s*["']?([^"'#\n]+?)["']?\s*(#.*)?$/.exec(
      line,
    );
    if (!m) continue;
    if (m[1] === "scheme" || m[1] === "name") name = m[2].trim();
    else b[m[1].toLowerCase().replace("base0", "")] = hex(m[2]) ?? "";
  }
  if (!b["0"] || !b["5"]) throw new Error("Not a Base16 scheme.");
  const k = (x: string) => b[x.toLowerCase()];
  return finish(name, {
    background: k("0"),
    foreground: k("5"),
    cursor: k("5"),
    selection: k("2"),
    ansi: [
      k("0"),
      k("8"),
      k("b"),
      k("a"),
      k("d"),
      k("e"),
      k("c"),
      k("5"),
      k("3"),
      k("8"),
      k("b"),
      k("a"),
      k("d"),
      k("e"),
      k("c"),
      k("7"),
    ],
  });
}

const WT = ["black", "red", "green", "yellow", "blue", "purple", "cyan", "white"];

/** Windows Terminal scheme JSON (one scheme, or `{ schemes: [...] }`). */
export function fromWindowsTerminal(text: string, fallbackName: string): Theme {
  let j = JSON.parse(text);
  if (Array.isArray(j.schemes)) j = j.schemes[0];
  const c = (k: string) => hex(j[k]);
  return finish(typeof j.name === "string" ? j.name : fallbackName, {
    background: c("background"),
    foreground: c("foreground"),
    cursor: c("cursorColor"),
    selection: c("selectionBackground"),
    ansi: [...WT.map((n) => c(n)), ...WT.map((n) => c(`bright${n[0].toUpperCase()}${n.slice(1)}`))],
  });
}

/** Ghostty theme (`palette = N=#hex`, `background = hex`…). */
export function fromGhostty(text: string, name: string): Theme {
  const ansi: Partial16 = [];
  const kv: Record<string, string | undefined> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [k, ...rest] = line.split("=");
    const key = k.trim();
    const value = rest.join("=").trim();
    if (key === "palette") {
      const [i, color] = value.split("=");
      ansi[Number(i)] = hex(color);
    } else kv[key] = hex(value);
  }
  return finish(name, {
    background: kv.background,
    foreground: kv.foreground,
    cursor: kv["cursor-color"],
    cursorText: kv["cursor-text"],
    selection: kv["selection-background"],
    selectionText: kv["selection-foreground"],
    ansi,
  });
}

const ALA = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

/** Alacritty TOML (`[colors.primary]`, `[colors.normal]`, `[colors.bright]`). */
export function fromAlacritty(text: string, name: string): Theme {
  const t = parseToml(text) as Record<string, Record<string, Record<string, unknown>>>;
  const c = t.colors;
  if (!c) throw new Error("Not an Alacritty theme: no [colors].");
  return finish(name, {
    background: hex(c.primary?.background),
    foreground: hex(c.primary?.foreground),
    cursor: hex(c.cursor?.cursor),
    cursorText: hex(c.cursor?.text),
    selection: hex(c.selection?.background),
    selectionText: hex(c.selection?.text),
    ansi: [...ALA.map((n) => hex(c.normal?.[n])), ...ALA.map((n) => hex(c.bright?.[n]))],
  });
}

/** Picks the parser from the file name, then from the content. */
export function importTheme(fileName: string, text: string): Theme {
  const base =
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim() || "Imported";
  const ext = fileName.split(".").pop()?.toLowerCase();
  const name = base.replace(/\b\w/g, (c) => c.toUpperCase());
  if (ext === "itermcolors" || text.includes("<plist")) return fromITerm(text, name);
  if (ext === "json" || text.trimStart().startsWith("{")) return fromWindowsTerminal(text, name);
  if (/^\s*base0[0-9a-f]\s*:/im.test(text)) return fromBase16(text, name);
  if (/\[colors\.(primary|normal)\]/.test(text)) return fromAlacritty(text, name);
  if (/^\s*palette\s*=/m.test(text)) return fromGhostty(text, name);
  throw new Error(
    "Unknown format. Use .itermcolors, Base16 YAML, Windows Terminal JSON, Ghostty or Alacritty TOML.",
  );
}
