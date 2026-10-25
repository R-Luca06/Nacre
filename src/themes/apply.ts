import type { ITheme } from "@xterm/xterm";
import { isDark, mix, withAlpha } from "./color";
import { ANSI_NAMES, type Theme } from "./types";

export interface ChromeTokens {
  "--bg": string;
  "--bg-raised": string;
  "--bg-hover": string;
  "--line": string;
  "--text": string;
  "--text-dim": string;
  "--accent": string;
  "--warn": string;
  "--danger": string;
  "--ok": string;
  "--pearl": string;
  "--scheme": string;
}

const PEARL_DARK = "linear-gradient(90deg, #9ED8CF, #C8C2E8 55%, #E9DCC6)";
const PEARL_LIGHT = "linear-gradient(90deg, #2E8C80, #7A6FB8 55%, #B8925A)";

/** Chrome colors derived from the terminal theme so the window reads as one surface. */
export function chromeTokens(theme: Theme): ChromeTokens {
  const bg = theme.background;
  const fg = theme.foreground;
  const dark = isDark(bg);
  return {
    "--bg": bg,
    "--bg-raised": dark ? mix(bg, fg, 0.05) : mix(bg, "#ffffff", 0.7),
    "--bg-hover": mix(bg, fg, dark ? 0.08 : 0.06),
    "--line": mix(bg, fg, dark ? 0.12 : 0.13),
    "--text": fg,
    "--text-dim": mix(fg, bg, 0.45),
    "--accent": theme.accent ?? theme.ansi[4],
    "--warn": theme.ansi[3],
    "--danger": theme.ansi[1],
    "--ok": theme.ansi[2],
    "--pearl": dark ? PEARL_DARK : PEARL_LIGHT,
    "--scheme": dark ? "dark" : "light",
  };
}

export function xtermTheme(theme: Theme): ITheme {
  const out: ITheme = {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    cursorAccent: theme.cursorText ?? theme.background,
    selectionBackground: theme.selection,
    selectionForeground: theme.selectionText,
    selectionInactiveBackground: withAlpha(theme.selection, 0.6),
    scrollbarSliderBackground: withAlpha(theme.foreground, 0.12),
    scrollbarSliderHoverBackground: withAlpha(theme.foreground, 0.22),
    scrollbarSliderActiveBackground: withAlpha(theme.foreground, 0.3),
  };
  ANSI_NAMES.forEach((name, i) => {
    out[name] = theme.ansi[i];
  });
  return out;
}

export function applyChrome(tokens: ChromeTokens) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
  root.style.colorScheme = tokens["--scheme"];
}
