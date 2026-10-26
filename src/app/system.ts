import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { t } from "../i18n";
import { parseCombo } from "../keybindings/combo";
import { useConfig } from "../store/config";
import { useWorkspace } from "../store/workspace";
import { toAccelerator } from "./menu";

export const isQuake = () => new URLSearchParams(location.search).has("quake");

/** `ctrl+\`` → `Ctrl+Backquote` for the global shortcut. */
function globalAccelerator(combo: string): string | null {
  const c = parseCombo(combo);
  if (!c || c.includes(" ")) return null;
  if (c.endsWith("+`") || c === "`") {
    const mods = c.split("+").slice(0, -1);
    return toAccelerator([...mods, "a"].join("+"))?.replace(/A$/, "Backquote") ?? null;
  }
  return toAccelerator(c) ?? null;
}

let last = "";

/** Applies settings that live outside the window (global shortcut, menu bar, login item). */
async function apply() {
  const c = useConfig.getState().config;
  const key = JSON.stringify([c.quake, c.general.tray, c.general.launch_at_login]);
  if (key === last) return;
  last = key;
  const ws = useWorkspace.getState();
  const acc = globalAccelerator(c.quake.shortcut);
  if (c.quake.enabled && !acc) ws.showToast(t("quake.shortcut is not a valid shortcut"), "warn");
  await invoke("quake_configure", {
    enabled: c.quake.enabled && !!acc,
    shortcut: acc ?? "",
    height: c.quake.height,
    hideOnBlur: c.quake.hide_on_blur,
  }).catch((e) => ws.showToast(String(e), "warn"));
  await invoke("tray_set", {
    enabled: c.general.tray,
    labels: {
      newWindow: t("New Window"),
      workspaces: t("Workspaces"),
      waiting: t("Claude is waiting"),
      quit: t("Quit Nacre"),
    },
  }).catch((e) => ws.showToast(String(e), "warn"));
  try {
    const on = await isEnabled();
    if (on !== c.general.launch_at_login) await (c.general.launch_at_login ? enable() : disable());
  } catch {
    /* not available in dev builds */
  }
}

export function initSystem() {
  void apply();
  useConfig.subscribe((s, prev) => {
    if (s.config !== prev.config) void apply();
  });
  const secure = (focused: boolean) =>
    void invoke("secure_input", {
      enabled: focused && useConfig.getState().config.general.secure_input,
    });
  void getCurrentWindow().onFocusChanged(({ payload }) => secure(payload));
  useConfig.subscribe((s, prev) => {
    if (s.config.general.secure_input !== prev.config.general.secure_input)
      secure(document.hasFocus());
  });
  if (isQuake()) document.documentElement.classList.add("quake");
}
