import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";
import * as pty from "../ipc/pty";
import {
  type LayoutNode,
  type Preset,
  type Side,
  equalize,
  move,
  neighbor,
  pane,
  paneIds,
  preset,
  remove,
  resizeToward,
  split,
  swap,
} from "../layout/tree";
import { t } from "../i18n";
import { useConfig } from "../store/config";
import { type PaneMeta, type Tab, activeTab, tabOfPane, useWorkspace } from "../store/workspace";
import {
  allSessions,
  createSession,
  disposeSession,
  getSession,
  updateAllSessions,
} from "../terminal/registry";
import type { LaunchOptions } from "../terminal/session";
import { homeDir, isDangerousPaste } from "./paths";
import { ackPane, sessionForPane } from "../claude/store";

const ws = () => useWorkspace.getState();

export function uid(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

function expandHome(p: string | undefined): string | undefined {
  if (!p) return undefined;
  if (p === "~") return homeDir();
  if (p.startsWith("~/")) return homeDir() + p.slice(1);
  return p;
}

export function defaultLaunch(cwd?: string): LaunchOptions {
  const c = useConfig.getState().config;
  return {
    cwd: cwd ?? expandHome(c.shell.cwd),
    shell: c.shell.program || undefined,
    args: c.shell.args.length ? c.shell.args : undefined,
    env: Object.keys(c.shell.env).length ? c.shell.env : undefined,
  };
}

function makePane(launch: LaunchOptions): string {
  const id = uid("p");
  const meta: PaneMeta = { id, launch, cwd: launch.cwd };
  ws().addPane(meta);
  createSession(id, launch);
  return id;
}

/** Best known working directory: OSC 7, then the foreground process. */
export async function paneCwd(id: string | undefined): Promise<string | undefined> {
  if (!id) return undefined;
  const meta = ws().panes[id];
  try {
    const info = await pty.info(id);
    if (info?.cwd) return info.cwd;
  } catch {
    /* pane gone */
  }
  return meta?.cwd;
}

const activePaneId = () => activeTab()?.active;

export async function newTab(
  opts: { cwd?: string; command?: string; launch?: LaunchOptions; after?: string } = {},
) {
  const cwd = opts.cwd ?? (await paneCwd(activePaneId()));
  const id = makePane(opts.launch ?? { ...defaultLaunch(cwd), command: opts.command });
  const tab: Tab = { id: uid("t"), root: pane(id), active: id, zoomed: null };
  const { tabs } = ws();
  const at = opts.after ? tabs.findIndex((x) => x.id === opts.after) + 1 : tabs.length;
  const next = [...tabs];
  next.splice(at > 0 ? at : tabs.length, 0, tab);
  ws().setTabs(next, tab.id);
  return tab;
}

export async function splitPane(
  side: Side,
  opts: { cwd?: string; command?: string; launch?: LaunchOptions } = {},
) {
  const tab = activeTab();
  if (!tab) return;
  const cwd = opts.cwd ?? (await paneCwd(tab.active));
  const id = makePane(opts.launch ?? { ...defaultLaunch(cwd), command: opts.command });
  ws().updateTab(tab.id, {
    root: split(tab.root, tab.active, side, id, uid("s")),
    active: id,
    zoomed: null,
  });
  focusPane(id);
  return id;
}

export function focusPane(id: string) {
  const tab = tabOfPane(id);
  if (!tab) return;
  if (tab.active !== id) ws().updateTab(tab.id, { active: id });
  if (ws().activeTabId !== tab.id) ws().setActiveTab(tab.id);
  ws().updatePane(id, { bell: false, activity: false });
  if (sessionForPane(id)?.attention && document.hasFocus()) ackPane(id);
  requestAnimationFrame(() => getSession(id)?.focus());
}

export function selectTab(id: string) {
  const tab = ws().tabs.find((x) => x.id === id);
  if (!tab) return;
  ws().setActiveTab(id);
  for (const p of paneIds(tab.root)) ws().updatePane(p, { bell: false, activity: false });
  focusPane(tab.active);
}

export function cycleTab(delta: number) {
  const { tabs, activeTabId } = ws();
  if (tabs.length < 2) return;
  const i = tabs.findIndex((x) => x.id === activeTabId);
  selectTab(tabs[(i + delta + tabs.length) % tabs.length].id);
}

export function gotoTab(n: number) {
  const { tabs } = ws();
  const tab = n === 9 ? tabs.at(-1) : tabs[n - 1];
  if (tab) selectTab(tab.id);
}

export function moveTab(delta: number) {
  const { tabs, activeTabId } = ws();
  const i = tabs.findIndex((x) => x.id === activeTabId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= tabs.length) return;
  const next = [...tabs];
  [next[i], next[j]] = [next[j], next[i]];
  ws().setTabs(sortPinned(next));
}

export function reorderTab(id: string, toIndex: number) {
  const tabs = [...ws().tabs];
  const from = tabs.findIndex((x) => x.id === id);
  if (from < 0) return;
  const [tab] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(tabs.length, toIndex)), 0, tab);
  ws().setTabs(sortPinned(tabs));
}

const sortPinned = (tabs: Tab[]) => [
  ...tabs.filter((x) => x.pinned),
  ...tabs.filter((x) => !x.pinned),
];

export function togglePin(id = ws().activeTabId) {
  const tab = ws().tabs.find((x) => x.id === id);
  if (!tab) return;
  ws().updateTab(id, { pinned: !tab.pinned });
  ws().setTabs(sortPinned(ws().tabs));
}

/** Running non-shell processes among the given panes. */
async function runningIn(ids: string[]): Promise<string[]> {
  const names: string[] = [];
  await Promise.all(
    ids.map(async (id) => {
      try {
        const info = await pty.info(id);
        if (info && !info.isShell && !getSession(id)?.exited) names.push(info.name);
      } catch {
        /* already gone */
      }
    }),
  );
  return names;
}

function confirmRunning(names: string[], title: string, onConfirm: () => void) {
  if (names.length === 0 || !useConfig.getState().config.general.confirm_close) {
    onConfirm();
    return;
  }
  ws().setOverlay({
    kind: "confirm",
    confirm: {
      title,
      detail:
        names.length === 1
          ? t("{name} is running.", { name: names[0] })
          : t("{n} processes are running.", { n: names.length }),
      action: t("Close"),
      onConfirm,
    },
  });
}

export async function closePane(id = activePaneId(), force = false) {
  if (!id) return;
  const tab = tabOfPane(id);
  if (!tab) return;
  if (paneIds(tab.root).length === 1) return closeTab(tab.id, force);
  const doClose = () => {
    const root = remove(tab.root, id);
    if (!root) return;
    const remaining = paneIds(root);
    const active = tab.active === id ? nearest(tab.root, id, remaining) : tab.active;
    ws().updateTab(tab.id, { root, active, zoomed: null });
    disposeSession(id);
    ws().removePanes([id]);
    if (ws().activeTabId === tab.id) focusPane(active);
  };
  if (force) return doClose();
  confirmRunning(await runningIn([id]), t("Close pane?"), doClose);
}

function nearest(root: LayoutNode, id: string, remaining: string[]): string {
  for (const side of ["left", "up", "right", "down"] as const) {
    const n = neighbor(root, id, side);
    if (n && remaining.includes(n)) return n;
  }
  return remaining[0];
}

export async function closeTab(id = ws().activeTabId, force = false) {
  const tab = ws().tabs.find((x) => x.id === id);
  if (!tab) return;
  const ids = paneIds(tab.root);
  const doClose = () => {
    const { tabs, panes } = ws();
    const index = tabs.findIndex((x) => x.id === id);
    ws().pushClosed({
      tab,
      index,
      cwds: Object.fromEntries(ids.map((p) => [p, panes[p]?.cwd])),
    });
    const rest = tabs.filter((x) => x.id !== id);
    for (const p of ids) disposeSession(p);
    ws().removePanes(ids);
    if (rest.length === 0) {
      ws().setTabs([], "");
      void getCurrentWindow().destroy();
      return;
    }
    const nextActive =
      ws().activeTabId === id ? rest[Math.min(index, rest.length - 1)].id : ws().activeTabId;
    ws().setTabs(rest, nextActive);
    selectTab(nextActive);
  };
  if (force) return doClose();
  confirmRunning(await runningIn(ids), t("Close tab?"), doClose);
}

/** Recreates a closed tab with the same layout and directories (fresh shells). */
export function reopenTab() {
  const closed = ws().popClosed();
  if (!closed) return;
  const map = new Map<string, string>();
  const remap = (node: LayoutNode): LayoutNode => {
    if (node.kind === "pane") {
      const id = makePane(defaultLaunch(closed.cwds[node.id]));
      map.set(node.id, id);
      return pane(id);
    }
    return { ...node, id: uid("s"), children: node.children.map(remap) };
  };
  const root = remap(closed.tab.root);
  const tab: Tab = {
    ...closed.tab,
    id: uid("t"),
    root,
    active: map.get(closed.tab.active) ?? paneIds(root)[0],
    zoomed: null,
  };
  const tabs = [...ws().tabs];
  tabs.splice(Math.min(closed.index, tabs.length), 0, tab);
  ws().setTabs(sortPinned(tabs), tab.id);
  focusPane(tab.active);
}

export async function duplicateTab() {
  const tab = activeTab();
  if (!tab) return;
  const cwd = await paneCwd(tab.active);
  const created = await newTab({ cwd, after: tab.id });
  if (tab.color) ws().updateTab(created.id, { color: tab.color });
}

export function focusDir(side: Side) {
  const tab = activeTab();
  if (!tab || tab.zoomed) return;
  const n = neighbor(tab.root, tab.active, side);
  if (n) focusPane(n);
}

export function resizeDir(side: Side, amount = 0.05) {
  const tab = activeTab();
  if (!tab) return;
  ws().updateTab(tab.id, { root: resizeToward(tab.root, tab.active, side, amount) });
}

export function toggleZoom() {
  const tab = activeTab();
  if (!tab || paneIds(tab.root).length < 2) return;
  ws().updateTab(tab.id, { zoomed: tab.zoomed ? null : tab.active });
  focusPane(tab.active);
}

export function equalizePanes() {
  const tab = activeTab();
  if (tab) ws().updateTab(tab.id, { root: equalize(tab.root) });
}

export function swapNext() {
  const tab = activeTab();
  if (!tab) return;
  const ids = paneIds(tab.root);
  if (ids.length < 2) return;
  const other = ids[(ids.indexOf(tab.active) + 1) % ids.length];
  ws().updateTab(tab.id, { root: swap(tab.root, tab.active, other) });
}

export function movePane(id: string, target: string, side: Side) {
  const tab = tabOfPane(id);
  if (!tab || tabOfPane(target)?.id !== tab.id) return;
  ws().updateTab(tab.id, { root: move(tab.root, id, target, side, uid("s")), zoomed: null });
  focusPane(id);
}

export function applyPreset(kind: Preset) {
  const tab = activeTab();
  if (!tab) return;
  ws().updateTab(tab.id, { root: preset(paneIds(tab.root), kind, () => uid("s")), zoomed: null });
}

export function toggleBroadcast() {
  const tab = activeTab();
  if (tab) ws().updateTab(tab.id, { broadcast: !tab.broadcast });
}

/** Moves the active pane into its own tab (V3: across tabs). */
export function paneToNewTab() {
  const tab = activeTab();
  if (!tab || paneIds(tab.root).length < 2) return;
  const id = tab.active;
  const root = remove(tab.root, id)!;
  ws().updateTab(tab.id, { root, active: paneIds(root)[0], zoomed: null });
  const created: Tab = { id: uid("t"), root: pane(id), active: id, zoomed: null };
  const tabs = [...ws().tabs];
  tabs.splice(tabs.findIndex((x) => x.id === tab.id) + 1, 0, created);
  ws().setTabs(tabs, created.id);
  focusPane(id);
}

export function renameTab(id: string, title: string) {
  ws().updateTab(id, { title: title.trim() || undefined });
}

export function setTabColor(id: string, color: string | undefined) {
  ws().updateTab(id, { color });
}

// Edit

const activeSession = () => {
  const id = activePaneId();
  return id ? getSession(id) : undefined;
};

function focusedInput(): HTMLInputElement | HTMLTextAreaElement | null {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.closest(".xterm") ? null : el;
  }
  return null;
}

export function copy(): boolean {
  if (focusedInput()) return document.execCommand("copy");
  const s = activeSession();
  if (!s?.hasSelection()) return false;
  void writeText(s.getSelection());
  return true;
}

export async function paste() {
  const input = focusedInput();
  const text = await readText().catch(() => "");
  if (!text) return;
  if (input) {
    input.setRangeText(text, input.selectionStart ?? 0, input.selectionEnd ?? 0, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const s = activeSession();
  if (!s) return;
  pasteText(s.id, text);
}

export function pasteText(paneId: string, text: string) {
  const s = getSession(paneId);
  if (!s) return;
  const multiline = /[\r\n]/.test(text.replace(/[\r\n]+$/, ""));
  const risky = (multiline && !s.term.modes.bracketedPasteMode) || isDangerousPaste(text);
  if (!risky || !useConfig.getState().config.terminal.paste_warning) {
    s.paste(text);
    return;
  }
  const preview = text.length > 400 ? `${text.slice(0, 400)}…` : text;
  ws().setOverlay({
    kind: "confirm",
    confirm: {
      title: t("Paste?"),
      detail: preview,
      action: t("Paste"),
      onConfirm: () => {
        s.paste(text);
        s.focus();
      },
    },
  });
}

export function selectAll() {
  const input = focusedInput();
  if (input) input.select();
  else activeSession()?.term.selectAll();
}

export function clearScreen() {
  const s = activeSession();
  if (!s) return;
  s.term.clear();
  // Ask the shell to redraw its prompt.
  s.send("\x0c");
}

export function openSearch() {
  const id = activePaneId();
  if (id) ws().setSearch(id);
}

export function scroll(where: "top" | "bottom" | "pageUp" | "pageDown") {
  const s = activeSession();
  if (!s) return;
  if (where === "top") s.term.scrollToTop();
  else if (where === "bottom") s.term.scrollToBottom();
  else s.term.scrollPages(where === "pageUp" ? -1 : 1);
}

// View

export function zoomFont(delta: number | "reset") {
  const c = useConfig.getState();
  c.setZoom(delta === "reset" ? 0 : Math.max(-8, Math.min(40, c.zoom + delta)));
  updateAllSessions();
}

// Window

export async function newWindow() {
  const cwd = await paneCwd(activePaneId());
  await invoke("window_new", { cwd: cwd ?? null });
}

export async function closeWindow() {
  const ids = ws().tabs.flatMap((x) => paneIds(x.root));
  confirmRunning(await runningIn(ids), t("Close window?"), () => {
    for (const s of allSessions()) disposeSession(s.id);
    void getCurrentWindow().destroy();
  });
}

export async function toggleFullscreen() {
  const w = getCurrentWindow();
  await w.setFullscreen(!(await w.isFullscreen()));
}

export async function toggleAlwaysOnTop() {
  const w = getCurrentWindow();
  await w.setAlwaysOnTop(!(await w.isAlwaysOnTop()));
}

export function selectTabThen(id: string, then: "rename" | "duplicate") {
  selectTab(id);
  if (then === "rename") ws().setOverlay({ kind: "rename", tabId: id });
  else void duplicateTab();
}

export async function quit() {
  const busy = await invoke<string[]>("pty_busy").catch(() => []);
  confirmRunning(busy, t("Quit Nacre?"), () => void invoke("app_quit"));
}

export function openConfigFile() {
  const path = useConfig.getState().path;
  if (path) void openPath(path);
}

export function openSettings() {
  openConfigFile();
}
