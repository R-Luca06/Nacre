import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { useWorkspace } from "../store/workspace";
import { tildify } from "../app/paths";

export interface InstallStatus {
  hooks: boolean;
  statusline: boolean;
  existingStatusline: string | null;
  settingsPath: string;
  cliPath: string;
}

export const installStatus = () => invoke<InstallStatus>("claude_install_status");

export function useInstallStatus() {
  const [s, setS] = useState<InstallStatus | null>(null);
  useEffect(() => {
    void installStatus().then(setS, () => setS(null));
  }, []);
  return s;
}

const ws = () => useWorkspace.getState();

/** Asks first, then edits ~/.claude/settings.json (backed up by the backend). */
export async function connectClaude() {
  let s: InstallStatus;
  try {
    s = await installStatus();
  } catch (e) {
    ws().showToast(String(e), "warn");
    return;
  }
  const path = tildify(s.settingsPath);
  const lines = [t("Adds Nacre hooks to {path}.", { path })];
  lines.push(
    s.existingStatusline
      ? t("Your status line ({cmd}) keeps working; Nacre reads its data.", {
          cmd: s.existingStatusline,
        })
      : t("Sets a status line that also feeds Nacre."),
  );
  lines.push(t("A backup is saved next to it. Undo from the palette."));
  ws().setOverlay({
    kind: "confirm",
    confirm: {
      title: t("Connect Claude Code?"),
      detail: lines.join("\n"),
      action: t("Connect"),
      onConfirm: () => {
        invoke<string>("claude_install", { statusline: true }).then(
          () => ws().showToast(t("Claude Code connected. New sessions report live.")),
          (e) => ws().showToast(String(e), "warn"),
        );
      },
    },
  });
}

export function disconnectClaude() {
  ws().setOverlay({
    kind: "confirm",
    confirm: {
      title: t("Disconnect Claude Code?"),
      detail: t("Removes Nacre hooks and restores your status line."),
      action: t("Disconnect"),
      onConfirm: () => {
        invoke<string>("claude_uninstall").then(
          () => ws().showToast(t("Claude Code disconnected.")),
          (e) => ws().showToast(String(e), "warn"),
        );
      },
    },
  });
}
