import { create } from "zustand";
import { type Config, defaults, normalizeConfig } from "../config/schema";
import { builtinThemes, fallbackTheme } from "../themes/builtin";
import type { Theme } from "../themes/types";
import { xtermTheme } from "../themes/apply";
import type { TerminalSettings } from "../terminal/session";

export const BUNDLED_MONO = "JetBrains Mono Variable";

interface ConfigState {
  config: Config;
  errors: string[];
  /** Errors from theme files and `[keys]`, shown with config errors. */
  extraErrors: string[];
  path: string;
  userThemes: Theme[];
  systemDark: boolean;
  /** Per-window font zoom, in points. */
  zoom: number;
  setRaw: (raw: unknown, parseError?: string | null) => void;
  setUserThemes: (themes: Theme[]) => void;
  setSystemDark: (dark: boolean) => void;
  setZoom: (zoom: number) => void;
  setExtraErrors: (errors: string[]) => void;
}

export const useConfig = create<ConfigState>((set) => ({
  config: defaults,
  errors: [],
  extraErrors: [],
  path: "",
  userThemes: [],
  systemDark: true,
  zoom: 0,
  setRaw: (raw, parseError) => {
    if (parseError) {
      // Keep the last good config; only surface the error.
      set({ errors: [parseError] });
      return;
    }
    const { config, errors } = normalizeConfig(raw);
    set({ config, errors });
  },
  setUserThemes: (userThemes) => set({ userThemes }),
  setSystemDark: (systemDark) => set({ systemDark }),
  setZoom: (zoom) => set({ zoom }),
  setExtraErrors: (extraErrors) => set({ extraErrors }),
}));

export function allThemes(s: Pick<ConfigState, "userThemes"> = useConfig.getState()): Theme[] {
  const user = new Map(s.userThemes.map((t) => [t.name, t]));
  return [...builtinThemes.filter((t) => !user.has(t.name)), ...s.userThemes];
}

export function findTheme(name: string, s = useConfig.getState()): Theme | undefined {
  const lower = name.toLowerCase();
  return allThemes(s).find((t) => t.name.toLowerCase() === lower);
}

export function activeThemeName(s = useConfig.getState()): string {
  const { mode, dark, light } = s.config.theme;
  if (mode === "light") return light;
  if (mode === "system") return s.systemDark ? dark : light;
  return dark;
}

export function activeTheme(s = useConfig.getState()): Theme {
  return findTheme(activeThemeName(s), s) ?? fallbackTheme;
}

export function fontStack(family: string): string {
  const quoted = family
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => (/^[\w-]+$/.test(f) ? f : `"${f.replace(/"/g, "")}"`));
  return [...quoted, `"${BUNDLED_MONO}"`, '"SF Mono"', "Menlo", "monospace"].join(", ");
}

export function terminalSettings(s = useConfig.getState(), theme?: Theme): TerminalSettings {
  const c = s.config;
  return {
    fontFamily: fontStack(c.font.family),
    fontSize: Math.max(6, c.font.size + s.zoom),
    lineHeight: c.font.line_height,
    letterSpacing: c.font.letter_spacing,
    cursorStyle: c.cursor.style,
    cursorBlink: c.cursor.blink,
    scrollback: c.terminal.scrollback,
    optionAsMeta: c.terminal.option_as_meta,
    copyOnSelect: c.terminal.copy_on_select,
    ligatures: c.font.ligatures,
    padding: c.window.padding,
    theme: xtermTheme(theme ?? activeTheme(s)),
  };
}
