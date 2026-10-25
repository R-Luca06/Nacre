import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setLanguage } from "../i18n";
import { rebuildKeymap } from "../keybindings/runtime";
import { BUNDLED_MONO, activeTheme, useConfig } from "../store/config";
import { useWorkspace } from "../store/workspace";
import { applyChrome, chromeTokens } from "../themes/apply";
import { setSessionEvents, updateAllSessions } from "../terminal/registry";
import { handleKeyEvent } from "../keybindings/runtime";
import { closeWindow, newTab } from "./ops";
import { initPaths } from "./paths";
import { sessionEvents, startProcessPolling } from "./sessionEvents";

/** Re-applies everything derived from config: chrome, language, keys, terminals. */
export function applyConfig() {
  const s = useConfig.getState();
  setLanguage(s.config.general.language);
  applyChrome(chromeTokens(activeTheme(s)));
  const keyErrors = rebuildKeymap(s.config.keys);
  updateAllSessions();
  return keyErrors;
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
  applyConfig();
  useConfig.subscribe((s, prev) => {
    if (
      s.config !== prev.config ||
      s.userThemes !== prev.userThemes ||
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

  const win = getCurrentWindow();
  void win.onCloseRequested((e) => {
    e.preventDefault();
    void closeWindow();
  });

  const params = new URLSearchParams(location.search);
  await newTab({ cwd: params.get("cwd") ?? undefined });
  startProcessPolling();

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
    Object.assign(window, { __nacre: { ws: useWorkspace, config: useConfig, ops, registry } });
  }

  setTimeout(() => void invoke("window_ready"), 30);
}
