import { t } from "../i18n";
import type { Bindings } from "../keybindings/keymap";
import { useWorkspace } from "../store/workspace";
import * as ops from "./ops";
import { connectClaude, disconnectClaude } from "../claude/install";
import { saveWorkspace } from "./workspaces";
import { saveLastAsSnippet } from "./snippets";
import {
  copyOutput,
  exportScrollback,
  jumpPrompt,
  lastBlockAction,
  rerun,
  selectOutput,
} from "../terminal/blockActions";

export interface Action {
  id: string;
  /** English label; translated at display time. */
  label: string;
  group: "Tab" | "Pane" | "Window" | "Edit" | "View" | "App";
  keys: string[];
  /** Return false to let the key reach the terminal. */
  run: () => unknown;
  /** Hidden from the palette (still bindable). */
  hidden?: boolean;
}

const ws = () => useWorkspace.getState();

const list: Action[] = [];
const add = (
  id: string,
  label: string,
  group: Action["group"],
  keys: string[],
  run: () => unknown,
  hidden?: boolean,
) => list.push({ id, label, group, keys, run, hidden });

// Tabs
add("tab.new", "New Tab", "Tab", ["cmd+t"], () => ops.newTab());
add("tab.close", "Close Tab", "Tab", ["alt+cmd+w"], () => ops.closeTab());
add("tab.next", "Next Tab", "Tab", ["shift+cmd+]", "ctrl+tab"], () => ops.cycleTab(1));
add("tab.prev", "Previous Tab", "Tab", ["shift+cmd+[", "ctrl+shift+tab"], () => ops.cycleTab(-1));
for (let n = 1; n <= 9; n++) {
  add(
    `tab.goto${n}`,
    n === 9 ? "Last Tab" : `Tab ${n}`,
    "Tab",
    [`cmd+${n}`],
    () => ops.gotoTab(n),
    true,
  );
}
add("tab.reopen", "Reopen Closed Tab", "Tab", ["shift+cmd+t"], () => ops.reopenTab());
add("tab.duplicate", "Duplicate Tab", "Tab", [], () => ops.duplicateTab());
add("tab.rename", "Rename Tab", "Tab", [], () =>
  ws().setOverlay({ kind: "rename", tabId: ws().activeTabId }),
);
add("tab.pin", "Pin Tab", "Tab", [], () => ops.togglePin());
add("tab.moveLeft", "Move Tab Left", "Tab", [], () => ops.moveTab(-1));
add("tab.moveRight", "Move Tab Right", "Tab", [], () => ops.moveTab(1));

// Panes
add("pane.splitRight", "Split Right", "Pane", ["cmd+d"], () => ops.splitPane("right"));
add("pane.splitDown", "Split Down", "Pane", ["shift+cmd+d"], () => ops.splitPane("down"));
add("pane.close", "Close Pane", "Pane", ["cmd+w"], () => ops.closePane());
add("pane.focusLeft", "Focus Left", "Pane", ["alt+cmd+arrowleft"], () => ops.focusDir("left"));
add("pane.focusRight", "Focus Right", "Pane", ["alt+cmd+arrowright"], () => ops.focusDir("right"));
add("pane.focusUp", "Focus Up", "Pane", ["alt+cmd+arrowup"], () => ops.focusDir("up"));
add("pane.focusDown", "Focus Down", "Pane", ["alt+cmd+arrowdown"], () => ops.focusDir("down"));
add("pane.growLeft", "Grow Left", "Pane", ["ctrl+cmd+arrowleft"], () => ops.resizeDir("left"));
add("pane.growRight", "Grow Right", "Pane", ["ctrl+cmd+arrowright"], () => ops.resizeDir("right"));
add("pane.growUp", "Grow Up", "Pane", ["ctrl+cmd+arrowup"], () => ops.resizeDir("up"));
add("pane.growDown", "Grow Down", "Pane", ["ctrl+cmd+arrowdown"], () => ops.resizeDir("down"));
add("pane.zoom", "Zoom Pane", "Pane", ["shift+cmd+enter"], () => ops.toggleZoom());
add("pane.equalize", "Equalize Panes", "Pane", ["ctrl+shift+cmd+e"], () => ops.equalizePanes());
add("pane.swap", "Swap with Next", "Pane", [], () => ops.swapNext());
add("pane.broadcast", "Broadcast Input", "Pane", ["alt+cmd+i"], () => ops.toggleBroadcast());
add("pane.toTab", "Move Pane to New Tab", "Pane", [], () => ops.paneToNewTab());
add("layout.columns", "Layout: Columns", "Pane", [], () => ops.applyPreset("columns"));
add("layout.rows", "Layout: Rows", "Pane", [], () => ops.applyPreset("rows"));
add("layout.grid", "Layout: Grid", "Pane", [], () => ops.applyPreset("grid"));
add("layout.mainStack", "Layout: Main + Stack", "Pane", [], () => ops.applyPreset("main-stack"));

// Window
add("window.new", "New Window", "Window", ["cmd+n"], () => ops.newWindow());
add("workspace.save", "Save Window as Workspace", "Window", [], () =>
  ws().setOverlay({
    kind: "prompt",
    prompt: {
      title: t("Save Window as Workspace"),
      placeholder: t("Name"),
      action: t("Save"),
      onSubmit: (name) => void saveWorkspace(name),
    },
  }),
);
add("window.close", "Close Window", "Window", ["shift+cmd+w"], () => ops.closeWindow());
add("window.fullscreen", "Toggle Full Screen", "Window", ["ctrl+cmd+f"], () =>
  ops.toggleFullscreen(),
);
add("window.onTop", "Always on Top", "Window", [], () => ops.toggleAlwaysOnTop());

// Edit
add("edit.copy", "Copy", "Edit", ["cmd+c"], () => ops.copy(), true);
add("edit.paste", "Paste", "Edit", ["cmd+v"], () => ops.paste(), true);
add("edit.selectAll", "Select All", "Edit", ["cmd+a"], () => ops.selectAll(), true);
add("edit.clear", "Clear", "Edit", ["shift+cmd+k"], () => ops.clearScreen());
add("edit.find", "Find", "Edit", ["cmd+f"], () => ops.openSearch());
add("prompt.prev", "Previous Prompt", "Edit", ["cmd+arrowup"], () => jumpPrompt(-1));
add("prompt.next", "Next Prompt", "Edit", ["cmd+arrowdown"], () => jumpPrompt(1));
add("block.copyOutput", "Copy Last Output", "Edit", ["shift+cmd+o"], () =>
  lastBlockAction(copyOutput),
);
add("block.selectOutput", "Select Last Output", "Edit", [], () => lastBlockAction(selectOutput));
add("block.rerun", "Run Last Command Again", "Edit", [], () => lastBlockAction(rerun));
const modeFor = (kind: "hints" | "copy") => {
  const id = ws().tabs.find((x) => x.id === ws().activeTabId)?.active;
  if (id) ws().setMode(ws().mode?.kind === kind ? null : { kind, paneId: id });
};
add("mode.hints", "Pick from Screen", "Edit", ["shift+cmd+u"], () => modeFor("hints"));
add("mode.copy", "Copy Mode", "Edit", ["shift+cmd+x"], () => modeFor("copy"));
add("edit.exportText", "Export Scrollback as Text", "Edit", [], () => exportScrollback("text"));
add("edit.exportHtml", "Export Scrollback as HTML", "Edit", [], () => exportScrollback("html"));
add("edit.scrollTop", "Scroll to Top", "Edit", ["cmd+home"], () => ops.scroll("top"));
add("edit.scrollBottom", "Scroll to Bottom", "Edit", ["cmd+end"], () => ops.scroll("bottom"));
add("edit.pageUp", "Page Up", "Edit", ["shift+pageup"], () => ops.scroll("pageUp"), true);
add("edit.pageDown", "Page Down", "Edit", ["shift+pagedown"], () => ops.scroll("pageDown"), true);

// View
add("view.zoomIn", "Bigger Text", "View", ["cmd+=", "cmd++", "shift+cmd+="], () => ops.zoomFont(1));
add("view.zoomOut", "Smaller Text", "View", ["cmd+-"], () => ops.zoomFont(-1));
add("view.zoomReset", "Actual Size", "View", ["cmd+0"], () => ops.zoomFont("reset"));
// Pickers
const picker = (mode: "history" | "dirs" | "snippets" | "ssh") => {
  const o = ws().overlay;
  ws().setOverlay(o?.kind === "palette" && o.mode === mode ? null : { kind: "palette", mode });
};
add("palette.history", "Search History", "App", ["shift+cmd+h"], () => picker("history"));
add("palette.dirs", "Go to Directory", "App", ["shift+cmd+j"], () => picker("dirs"));
add("palette.snippets", "Snippets", "App", ["shift+cmd+s"], () => picker("snippets"));
add("palette.ssh", "SSH Hosts", "App", ["shift+cmd+r"], () => picker("ssh"));
add("snippet.save", "Save Last Command as Snippet", "App", [], () => saveLastAsSnippet());

// AI in the terminal
const aiFor = (mode: "command" | "explain" | "summarize" | "fix") => {
  const id = ws().tabs.find((x) => x.id === ws().activeTabId)?.active;
  if (id)
    ws().setAi(ws().ai?.paneId === id && ws().ai?.mode === mode ? null : { paneId: id, mode });
};
add("ai.command", "Command from Text", "App", ["cmd+k"], () => aiFor("command"));
add("ai.explain", "Explain Error", "App", ["shift+cmd+e"], () => aiFor("explain"));
add("ai.summarize", "Summarize Output", "App", [], () => aiFor("summarize"));
add("ai.fix", "Suggest Fix", "App", ["alt+cmd+f"], () => aiFor("fix"));
add("ai.chat", "AI Chat", "App", ["shift+cmd+a"], () => ws().togglePanel("chat"));

// Claude
add("claude.dashboard", "Claude Sessions", "App", ["shift+cmd+c"], () =>
  ws().setOverlay(ws().overlay?.kind === "claude" ? null : { kind: "claude" }),
);
add("claude.history", "Claude History", "App", [], () =>
  ws().setOverlay({ kind: "claude", view: "history" }),
);
add("claude.usage", "Claude Usage", "App", [], () =>
  ws().setOverlay({ kind: "claude", view: "usage" }),
);
add("claude.split", "Claude in Split", "App", ["alt+cmd+c"], () =>
  ops.splitPane("right", { command: "claude" }),
);
add("claude.tab", "Claude in New Tab", "App", [], () => ops.newTab({ command: "claude" }));
add("claude.panel", "Claude Panel", "App", ["ctrl+cmd+c"], () => ws().togglePanel("claude"));
add("claude.connect", "Connect Claude Code", "App", [], () => connectClaude());
add("claude.disconnect", "Disconnect Claude Code", "App", [], () => disconnectClaude());
add("app.settings", "Settings", "App", ["cmd+,"], () => ops.openSettings());
add("app.openConfig", "Open Config File", "App", [], () => ops.openConfigFile());
add("app.quit", "Quit Nacre", "App", ["cmd+q"], () => ops.quit());
add("app.palette", "Command Palette", "App", ["shift+cmd+p"], () =>
  ws().setOverlay(ws().overlay?.kind === "palette" ? null : { kind: "palette" }),
);

export const actions: ReadonlyArray<Action> = list;
export const actionById = new Map(list.map((a) => [a.id, a]));

/** Registers extra actions (plugins). */
export function registerAction(a: Action) {
  if (actionById.has(a.id)) return;
  list.push(a);
  actionById.set(a.id, a);
}

export function unregisterAction(id: string) {
  const i = list.findIndex((a) => a.id === id);
  if (i >= 0) list.splice(i, 1);
  actionById.delete(id);
}

export function defaultBindings(): Bindings {
  return Object.fromEntries(list.map((a) => [a.id, a.keys]));
}

export const actionLabel = (a: Action) => t(a.label);
