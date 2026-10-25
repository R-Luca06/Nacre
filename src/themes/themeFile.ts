import { parseHex } from "./color";
import type { Theme } from "./types";

const REQUIRED = ["background", "foreground"] as const;

/** Validates a parsed theme file. Missing optional colors are derived. */
export function themeFromRaw(raw: unknown, file: string): { theme?: Theme; error?: string } {
  if (!raw || typeof raw !== "object") return { error: `themes/${file}: not a table` };
  const r = raw as Record<string, unknown>;
  const color = (k: string) =>
    typeof r[k] === "string" && parseHex(r[k] as string) ? (r[k] as string) : undefined;
  for (const k of REQUIRED) {
    if (!color(k)) return { error: `themes/${file}: "${k}" must be a hex color` };
  }
  const palette = r.palette;
  if (
    !Array.isArray(palette) ||
    palette.length !== 16 ||
    !palette.every((c) => typeof c === "string" && parseHex(c))
  ) {
    return { error: `themes/${file}: "palette" must list 16 hex colors` };
  }
  const name =
    typeof r.name === "string" && r.name.trim() ? r.name.trim() : file.replace(/\.toml$/, "");
  return {
    theme: {
      name,
      background: color("background")!,
      foreground: color("foreground")!,
      cursor: color("cursor") ?? color("foreground")!,
      cursorText: color("cursor_text"),
      selection: color("selection") ?? (palette[8] as string),
      selectionText: color("selection_text"),
      ansi: palette as string[],
      accent: color("accent"),
    },
  };
}

export function themeToToml(t: Theme): string {
  const lines = [
    `name = ${JSON.stringify(t.name)}`,
    `background = "${t.background}"`,
    `foreground = "${t.foreground}"`,
    `cursor = "${t.cursor}"`,
    `selection = "${t.selection}"`,
  ];
  if (t.cursorText) lines.push(`cursor_text = "${t.cursorText}"`);
  if (t.selectionText) lines.push(`selection_text = "${t.selectionText}"`);
  if (t.accent) lines.push(`accent = "${t.accent}"`);
  lines.push("palette = [");
  for (let i = 0; i < 16; i += 4) {
    lines.push(
      `  ${t.ansi
        .slice(i, i + 4)
        .map((c) => `"${c}"`)
        .join(", ")},`,
    );
  }
  lines.push("]", "");
  return lines.join("\n");
}
