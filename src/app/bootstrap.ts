import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setLanguage } from "../i18n";
import { rebuildKeymap } from "../keybindings/runtime";
import { BUNDLED_MONO, activeTheme, activeThemeName, findTheme, useConfig } from "../store/config";
import {
  type ThemeFile,
  initConfig,
  loadConfig,
  loadThemes,
  onConfigChanged,
  onThemesChanged,
} from "../ipc/config";
import { renderTemplate } from "../config/template";
import { themeFromRaw } from "../themes/themeFile";
import type { Theme } from "../themes/types";
import { defaultBindings } from "./actions";
import { useWorkspace } from "../store/workspace";
import { applyChrome, chromeTokens } from "../themes/apply";
import { setSessionEvents, updateAllSessions } from "../terminal/registry";
import { handleKeyEvent } from "../keybindings/runtime";
import { closeWindow, makePaneFor, newTab, uid } from "./ops";
import { restoreWindow, startAutosave, takeSaved } from "./persistence";
import { initWorkspaces } from "./workspaces";
import { initDragDrop } from "./dragDrop";
import { initPlugins } from "../plugins/host";
import { initPaths } from "./paths";
import { initMenu, refreshMenu } from "./menu";
import { initClaude } from "../claude/integration";
import { initRemote } from "./remote";
import { sessionEvents, startProcessPolling } from "./sessionEvents";

let themeErrors: string[] = [];

/** Re-applies everything derived from config: chrome, language, keys, terminals. */
export function applyConfig() {
  const s = useConfig.getState();
  setLanguage(s.config.general.language);
  refreshMenu();
  const theme = activeTheme(s);
  const errors = [...themeErrors];
  if (!findTheme(activeThemeName(s), s)) {
    errors.push(`theme: "${activeThemeName(s)}" not found, using ${theme.name}`);
  }
  applyChrome(chromeTokens((s.config.theme.ui && findTheme(s.config.theme.ui, s)) || theme));
  errors.push(...rebuildKeymap(s.config.keys));
  updateAllSessions();
  useConfig.getState().setExtraErrors(errors);
}

function applyThemeFiles(files: ThemeFile[]) {
  const themes: Theme[] = [];
  themeErrors = [];
  for (const f of files) {
    if (f.error) {
      themeErrors.push(f.error);
      continue;
    }
    const r = themeFromRaw(f.raw, f.file);
    if (r.theme) themes.push(r.theme);
    else if (r.error) themeErrors.push(r.error);
  }
  useConfig.getState().setUserThemes(themes);
}

async function loadConfiguration() {
  const [loaded, themes] = await Promise.all([loadConfig(), loadThemes()]);
  useConfig.setState({ path: loaded.path });
  applyThemeFiles(themes);
  useConfig.getState().setRaw(loaded.raw, loaded.error);
  void initConfig(renderTemplate(defaultBindings()));
  void onConfigChanged((l) => useConfig.getState().setRaw(l.raw, l.error));
  void onThemesChanged(applyThemeFiles);
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  useConfig.getState().setSystemDark(dark.matches);
  dark.addEventListener("change", (e) => useConfig.getState().setSystemDark(e.matches));
}

function isTextInput(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest(".xterm")) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

export async function bootstrap() {
  await invoke("pty_reset");
  await initPaths();
  await Promise.all([
    document.fonts.load(`13px "${BUNDLED_MONO}"`),
    document.fonts.load(`bold 13px "${BUNDLED_MONO}"`),
    document.fonts.load(`12px "Inter Variable"`),
  ]).catch(() => {});

  setSessionEvents(sessionEvents);
  await loadConfiguration();
  applyConfig();
  useConfig.subscribe((s, prev) => {
    if (
      s.config !== prev.config ||
      s.userThemes !== prev.userThemes ||
      s.pluginThemes !== prev.pluginThemes ||
      s.pluginTriggers !== prev.pluginTriggers ||
      s.systemDark !== prev.systemDark
    ) {
      applyConfig();
    }
  });

  // Keys outside terminals (tab bar, empty areas). Terminals route their own keys.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.defaultPrevented || (e.target as HTMLElement)?.closest?.(".xterm")) return;
      if (isTextInput(e.target) && !e.metaKey) return;
      if (isTextInput(e.target) && ["c", "v", "x", "a", "z"].includes(e.key.toLowerCase())) return;
      if (handleKeyEvent(e)) e.preventDefault();
    },
    true,
  );

  initMenu();
  initDragDrop();
  await initWorkspaces();
  await initPlugins();
  await initClaude();
  initRemote();
  const win = getCurrentWindow();
  void win.onCloseRequested((e) => {
    e.preventDefault();
    void closeWindow();
  });

  const params = new URLSearchParams(location.search);
  const restoreKey = params.get("restore");
  const saved = restoreKey ? await takeSaved(restoreKey).catch(() => null) : null;
  const restored = saved ? await restoreWindow(saved, makePaneFor, uid) : false;
  if (!restored) await newTab({ cwd: params.get("cwd") ?? undefined });
  startProcessPolling();
  startAutosave();

  useWorkspace.subscribe((s, prev) => {
    if (s.activeTabId !== prev.activeTabId || s.panes !== prev.panes) {
      const tab = s.tabs.find((x) => x.id === s.activeTabId);
      const meta = tab && s.panes[tab.active];
      void win.setTitle(meta?.proc && !meta.proc.isShell ? meta.proc.name : "Nacre");
    }
  });

  if (import.meta.env.DEV) {
    const ops = await import("./ops");
    const registry = await import("../terminal/registry");
    const workspaces = await import("./workspaces");
    Object.assign(window, {
      __nacre: { ws: useWorkspace, config: useConfig, ops, registry, workspaces },
    });
  }

  setTimeout(() => void invoke("window_ready"), 30);
}
