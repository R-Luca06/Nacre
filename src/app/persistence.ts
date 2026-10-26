import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { type LayoutNode, pane, paneIds } from "../layout/tree";
import { useConfig } from "../store/config";
import { type Tab, useWorkspace } from "../store/workspace";
import { getSession } from "../terminal/registry";

export interface SavedTab {
  title?: string;
  color?: string;
  pinned?: boolean;
  theme?: string;
  root: LayoutNode;
  active: string;
}

export interface SavedPane {
  cwd?: string;
  profile?: string;
  scrollback?: string;
}

export interface SavedWindow {
  bounds?: { x: number; y: number; w: number; h: number };
  activeTab: number;
  tabs: SavedTab[];
  panes: Record<string, SavedPane>;
}

const ws = () => useWorkspace.getState();

async function bounds() {
  const win = getCurrentWindow();
  try {
    const scale = await win.scaleFactor();
    const pos = (await win.outerPosition()).toLogical(scale);
    const size = (await win.innerSize()).toLogical(scale);
    return { x: pos.x, y: pos.y, w: size.width, h: size.height };
  } catch {
    return undefined;
  }
}

export async function snapshot(withScrollback: boolean): Promise<SavedWindow> {
  const { tabs, activeTabId, panes } = ws();
  const lines = useConfig.getState().config.general.restore_scrollback;
  const saved: SavedWindow = {
    bounds: await bounds(),
    activeTab: Math.max(
      0,
      tabs.findIndex((t) => t.id === activeTabId),
    ),
    tabs: tabs.map((t) => ({
      title: t.title,
      color: t.color,
      pinned: t.pinned,
      theme: t.theme,
      root: t.root,
      active: t.active,
    })),
    panes: {},
  };
  for (const t of tabs) {
    for (const id of paneIds(t.root)) {
      const meta = panes[id];
      const entry: SavedPane = { cwd: meta?.cwd, profile: meta?.profile };
      if (withScrollback && lines > 0) entry.scrollback = getSession(id)?.serialize(lines);
      saved.panes[id] = entry;
    }
  }
  return saved;
}

let timer = 0;
let lastScrollbackAt = 0;

/** Saves the layout shortly after changes; scrollback at most every 20 s. */
export function startAutosave() {
  const save = async () => {
    if (!ws().tabs.length) return;
    const withScrollback = Date.now() - lastScrollbackAt > 20_000;
    if (withScrollback) lastScrollbackAt = Date.now();
    await invoke("session_save", { state: await snapshot(withScrollback) }).catch(() => {});
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void save(), 1000);
  };
  useWorkspace.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs || s.activeTabId !== prev.activeTabId || s.panes !== prev.panes) {
      schedule();
    }
  });
  const win = getCurrentWindow();
  void win.onMoved(schedule);
  void win.onResized(schedule);
  void win.onFocusChanged(({ payload }) => {
    if (!payload) {
      lastScrollbackAt = 0;
      schedule();
    }
  });
  window.setInterval(() => {
    lastScrollbackAt = 0;
    schedule();
  }, 60_000);
  schedule();
}

export const takeSaved = (key: string) => invoke<SavedWindow | null>("session_take", { key });

/** Rebuilds a saved window with fresh shells in the same directories. */
export async function restoreWindow(
  saved: SavedWindow,
  makePane: (cwd: string | undefined, profile: string | undefined) => string,
  uid: (p: string) => string,
) {
  if (saved.bounds) {
    const win = getCurrentWindow();
    const { x, y, w, h } = saved.bounds;
    await win.setSize(new LogicalSize(w, h)).catch(() => {});
    await win.setPosition(new LogicalPosition(x, y)).catch(() => {});
  }
  const tabs: Tab[] = [];
  for (const st of saved.tabs) {
    const map = new Map<string, string>();
    const remap = (node: LayoutNode): LayoutNode => {
      if (node.kind === "pane") {
        const p = saved.panes[node.id] ?? {};
        const id = makePane(p.cwd, p.profile);
        if (p.scrollback) getSession(id)?.restoreText(p.scrollback);
        map.set(node.id, id);
        return pane(id);
      }
      return { ...node, id: uid("s"), children: node.children.map(remap) };
    };
    const root = remap(st.root);
    tabs.push({
      id: uid("t"),
      root,
      active: map.get(st.active) ?? paneIds(root)[0],
      zoomed: null,
      title: st.title,
      color: st.color,
      pinned: st.pinned,
      theme: st.theme,
    });
  }
  if (!tabs.length) return false;
  ws().setTabs(tabs, tabs[Math.min(saved.activeTab, tabs.length - 1)].id);
  const { setTabTheme } = await import("./ops");
  for (const tab of tabs) if (tab.theme) setTabTheme(tab.id, tab.theme);
  return true;
}
