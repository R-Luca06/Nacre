import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { t } from "../i18n";
import { useConfig } from "../store/config";
import { useWorkspace } from "../store/workspace";

const KEY = "nacre.lastUpdateCheck";

/** Checks GitHub Releases; offers a one-click install. */
export async function checkForUpdates(manual: boolean) {
  const ws = useWorkspace.getState();
  try {
    const update = await check();
    if (!update) {
      if (manual) ws.showToast(t("Nacre is up to date."));
      return;
    }
    ws.showToast(
      t("Nacre {version} is available. Click to install.", { version: update.version }),
      "info",
      undefined,
      async () => {
        ws.showToast(t("Downloading…"));
        await update.downloadAndInstall();
        await relaunch();
      },
    );
  } catch (e) {
    if (manual) ws.showToast(t("Update check failed: {error}", { error: String(e) }), "warn");
  }
}

export function autoCheck() {
  if (!useConfig.getState().config.general.check_updates || import.meta.env.DEV) return;
  let last = 0;
  try {
    last = Number(localStorage.getItem(KEY) ?? 0);
  } catch {
    /* storage unavailable */
  }
  if (Date.now() - last < 86_400_000) return;
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage unavailable */
  }
  window.setTimeout(() => void checkForUpdates(false), 5000);
}
