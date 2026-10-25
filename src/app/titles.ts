import type { PaneMeta, Tab } from "../store/workspace";
import { baseName } from "./paths";
import { lastShellSeen } from "./sessionEvents";

export function paneTitle(meta: PaneMeta | undefined): string {
  if (!meta) return "";
  const proc = meta.proc;
  if (proc && !proc.isShell) {
    const fresh = meta.oscTitle && (meta.oscTitleAt ?? 0) > lastShellSeen(meta.id);
    return fresh ? meta.oscTitle! : proc.name;
  }
  return baseName(meta.cwd) || proc?.name || "";
}

export function tabTitle(tab: Tab, panes: Record<string, PaneMeta>): string {
  return tab.title ?? paneTitle(panes[tab.active]);
}
