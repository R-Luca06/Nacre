import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Loaded {
  path: string;
  raw: unknown | null;
  error: string | null;
}

export interface ThemeFile {
  file: string;
  raw: unknown | null;
  error: string | null;
}

export const loadConfig = () => invoke<Loaded>("config_load");
export const initConfig = (template: string) => invoke<boolean>("config_init", { template });
export const loadThemes = () => invoke<ThemeFile[]>("themes_load");
export const setConfigValue = (path: string[], value: unknown) =>
  invoke<void>("config_set", { path, value });
export const saveTheme = (file: string, contents: string) =>
  invoke<string>("theme_save", { file, contents });

export const onConfigChanged = (fn: (l: Loaded) => void) =>
  listen<Loaded>("config-changed", (e) => fn(e.payload));
export const onThemesChanged = (fn: (t: ThemeFile[]) => void) =>
  listen<ThemeFile[]>("themes-changed", (e) => fn(e.payload));
