import { invoke } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { t } from "../i18n";
import { activeTab, useWorkspace } from "../store/workspace";
import type { Block } from "./blocks";
import { getSession } from "./registry";
import type { TerminalSession } from "./session";
import { useConfig } from "../store/config";
import { BUNDLED_MONO, activeTheme } from "../store/config";

const ws = () => useWorkspace.getState();

export function activeSession(): TerminalSession | undefined {
  const tab = activeTab();
  return tab ? getSession(tab.active) : undefined;
}

export function jumpPrompt(dir: -1 | 1): boolean {
  const s = activeSession();
  const line = s?.commands.promptLine(dir);
  if (!s || line === undefined) return false;
  s.term.scrollToLine(line);
  return true;
}

export function copyOutput(s: TerminalSession, b: Block) {
  void writeText(s.commands.outputText(b));
  ws().showToast(t("Output copied"));
}

export function selectOutput(s: TerminalSession, b: Block) {
  const r = s.commands.outputRange(b);
  if (r) s.term.selectLines(r[0], r[1]);
}

export function lastBlockAction(fn: (s: TerminalSession, b: Block) => void): boolean {
  const s = activeSession();
  const b = s?.commands.lastFinished();
  if (!s || !b) return false;
  fn(s, b);
  return true;
}

export function rerun(s: TerminalSession, b: Block) {
  if (!b.command) return;
  const meta = ws().panes[s.id];
  if (meta?.proc && !meta.proc.isShell) return;
  s.send(b.command.replace(/\n/g, "\r") + "\r");
  s.term.scrollToBottom();
  s.focus();
}

export function markdown(s: TerminalSession, b: Block): string {
  return ["```console", `$ ${b.command ?? ""}`, s.commands.outputText(b), "```", ""].join("\n");
}

/** Draws the block as plain monospace text on the theme background. */
export async function blockImage(s: TerminalSession, b: Block): Promise<string> {
  const theme = activeTheme();
  const font = useConfig.getState().config.font;
  const size = 13;
  const lh = Math.round(size * 1.45);
  const pad = 24;
  const lines = [`$ ${b.command ?? ""}`, ...s.commands.outputText(b).split("\n")].slice(0, 400);
  const scale = 2;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const family = `"${font.family}", "${BUNDLED_MONO}", monospace`;
  ctx.font = `${size}px ${family}`;
  const width = Math.min(1600, Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
  const height = lines.length * lh + pad * 2;
  c.width = width * scale;
  c.height = height * scale;
  ctx.scale(scale, scale);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  ctx.font = `${size}px ${family}`;
  ctx.textBaseline = "top";
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? (theme.accent ?? theme.ansi[4]) : theme.foreground;
    ctx.fillText(l, pad, pad + i * lh);
  });
  return c.toDataURL("image/png").split(",")[1];
}

export async function saveImage(s: TerminalSession, b: Block) {
  try {
    const data = await blockImage(s, b);
    const name = `nacre-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.png`;
    const path = await invoke<string>("save_download", { name, base64: data });
    ws().showToast(t("Saved to {path}", { path: path.replace(/^.*\/Downloads/, "~/Downloads") }));
  } catch (e) {
    ws().showToast(String(e), "warn");
  }
}

export async function exportScrollback(format: "text" | "html") {
  const s = activeSession();
  if (!s) return;
  let content: string;
  if (format === "html") {
    content = `<!doctype html><meta charset="utf-8"><title>Nacre</title>\n${s.serializeHtml()}`;
  } else {
    const buf = s.term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    content = lines.join("\n").trimEnd() + "\n";
  }
  const bytes = new TextEncoder().encode(content);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  try {
    const path = await invoke<string>("save_download", {
      name: `nacre-${stamp}.${format === "html" ? "html" : "txt"}`,
      base64: btoa(bin),
    });
    ws().showToast(t("Saved to {path}", { path: path.replace(/^.*\/Downloads/, "~/Downloads") }));
  } catch (e) {
    ws().showToast(String(e), "warn");
  }
}

/** Buffer row under a mouse event. */
export function rowAt(s: TerminalSession, e: MouseEvent): number | undefined {
  const screen = s.term.element?.querySelector(".xterm-screen");
  if (!screen) return undefined;
  const r = screen.getBoundingClientRect();
  const row = Math.floor(((e.clientY - r.top) / r.height) * s.term.rows);
  if (row < 0 || row >= s.term.rows) return undefined;
  return s.term.buffer.active.viewportY + row;
}

export async function showContextMenu(s: TerminalSession, e: MouseEvent) {
  const row = rowAt(s, e);
  const b = row !== undefined ? s.commands.blockAt(row) : undefined;
  const ops = await import("../app/ops");
  const blockItems = b?.finishedAt
    ? [
        { text: t("Copy Command"), action: () => void writeText(b.command ?? "") },
        { text: t("Copy Output"), action: () => copyOutput(s, b) },
        { text: t("Select Output"), action: () => selectOutput(s, b) },
        { text: t("Run Again"), action: () => rerun(s, b) },
        ...(b.exitCode
          ? [
              {
                text: t("Explain Error"),
                action: () => ws().setAi({ paneId: s.id, mode: "explain", blockId: b.id }),
              },
            ]
          : []),
        {
          text: t("Summarize Output"),
          action: () => ws().setAi({ paneId: s.id, mode: "summarize", blockId: b.id }),
        },
        {
          text: t("Filter Output…"),
          action: () => ws().setOverlay({ kind: "filter", paneId: s.id, blockId: b.id }),
        },
        {
          text: t("Share"),
          items: [
            {
              text: t("Copy as Markdown"),
              action: () => {
                void writeText(markdown(s, b));
                ws().showToast(t("Markdown copied"));
              },
            },
            { text: t("Save as Image"), action: () => void saveImage(s, b) },
          ],
        },
        { item: "Separator" as const },
      ]
    : [];
  const menu = await Menu.new({
    items: [
      ...(s.hasSelection() ? [{ text: t("Copy"), action: () => ops.copy() }] : []),
      { text: t("Paste"), action: () => void ops.paste() },
      { item: "Separator" },
      ...blockItems,
      { text: t("Split Right"), action: () => void ops.splitPane("right") },
      { text: t("Split Down"), action: () => void ops.splitPane("down") },
      { item: "Separator" },
      { text: t("Clear"), action: () => ops.clearScreen() },
    ],
  });
  await menu.popup();
}
