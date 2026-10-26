import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as pty from "../ipc/pty";
import { paneIds } from "../layout/tree";
import { type PaneMeta, type Tab, activeTab, useWorkspace } from "../store/workspace";
import {
  type PaneLook,
  createSession,
  disposeSession,
  getSession,
  paneLook,
} from "../terminal/registry";
import { selectTab, uid } from "./ops";

interface MovedTab {
  tab: Tab;
  panes: Record<string, { meta: PaneMeta; screen: string; look?: PaneLook }>;
}

const ws = () => useWorkspace.getState();

/** Moves the active tab, shells still running, to a new window or the next one. */
export async function moveTab(target: "new" | "next") {
  const tab = activeTab();
  if (!tab) return;
  let label: string | null = null;
  if (target === "next") {
    const labels = await invoke<string[]>("windows_list");
    const me = getCurrentWindow().label;
    if (labels.length < 2) return;
    label = labels[(labels.indexOf(me) + 1) % labels.length];
  } else if (ws().tabs.length < 2) {
    return;
  }
  const ids = paneIds(tab.root);
  const moved: MovedTab = { tab, panes: {} };
  for (const id of ids) {
    const s = getSession(id);
    const meta = ws().panes[id];
    if (!s || !meta) return;
    moved.panes[id] = { meta, screen: s.serialize(10_000), look: paneLook(id) };
  }
  for (const id of ids) {
    await pty.detach(id);
    getSession(id)?.release();
  }
  const key = uid("move");
  await invoke("session_stash", { key, state: moved });

  const index = ws().tabs.findIndex((x) => x.id === tab.id);
  const rest = ws().tabs.filter((x) => x.id !== tab.id);
  const next = rest[Math.min(index, rest.length - 1)];
  for (const id of ids) disposeSession(id);
  ws().removePanes(ids);
  ws().setTabs(rest, next?.id ?? "");
  if (next) selectTab(next.id);
  await invoke("tab_send", { target: label, key });
  if (!rest.length) await getCurrentWindow().destroy();
}

/** Opens a tab handed over by `moveTab`. */
export async function receiveTab(key: string): Promise<boolean> {
  const moved = await invoke<MovedTab | null>("session_take", { key }).catch(() => null);
  if (!moved) return false;
  for (const [id, p] of Object.entries(moved.panes)) {
    ws().addPane(p.meta);
    const s = createSession(id, { ...p.meta.launch, attach: true, replay: undefined }, p.look);
    s.term.write(p.screen);
  }
  ws().setTabs([...ws().tabs, moved.tab], moved.tab.id);
  selectTab(moved.tab.id);
  return true;
}
