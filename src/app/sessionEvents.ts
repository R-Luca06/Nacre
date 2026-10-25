import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import * as pty from "../ipc/pty";
import { paneIds } from "../layout/tree";
import { t } from "../i18n";
import { handleKeyEvent } from "../keybindings/runtime";
import { useConfig } from "../store/config";
import { activeTab, tabOfPane, useWorkspace } from "../store/workspace";
import { getSession } from "../terminal/registry";
import type { SessionEvents } from "../terminal/session";
import { ring } from "./bell";
import { closePane, focusPane } from "./ops";

const ws = () => useWorkspace.getState();

function onScreen(paneId: string): boolean {
  const tab = activeTab();
  if (!tab) return false;
  return tab.zoomed ? tab.zoomed === paneId : paneIds(tab.root).includes(paneId);
}

const isVisible = (paneId: string) => document.hasFocus() && onScreen(paneId);

export function sessionEvents(id: string): SessionEvents {
  const born = Date.now();
  return {
    onKey: (e) => handleKeyEvent(e),
    onInput: (data, session) => {
      if (session.exited) {
        void closePane(id, true);
        return true;
      }
      const tab = tabOfPane(id);
      if (tab?.broadcast) {
        for (const p of paneIds(tab.root)) getSession(p)?.send(data);
        return true;
      }
      return false;
    },
    onTitle: (title) => ws().updatePane(id, { oscTitle: title, oscTitleAt: Date.now() }),
    onCwd: (cwd) => ws().updatePane(id, { cwd, cwdFromOsc: true }),
    onFocus: () => {
      const tab = tabOfPane(id);
      if (tab && tab.active !== id) focusPane(id);
    },
    onOutput: () => {
      const meta = ws().panes[id];
      if (meta && !meta.activity && Date.now() - born > 1500 && !onScreen(id))
        ws().updatePane(id, { activity: true });
    },
    onBell: () => {
      const visible = isVisible(id);
      ring(id, useConfig.getState().config.terminal.bell, visible);
      if (!visible) ws().updatePane(id, { bell: true });
    },
    onSelection: (text) => {
      if (useConfig.getState().config.terminal.copy_on_select) void writeText(text);
    },
    onExit: (info) => {
      ws().updatePane(id, { exited: info });
      if (!ws().panes[id]) return;
      if (info.code === 0 || info.signal) {
        void closePane(id, true);
        return;
      }
      const s = getSession(id);
      const msg =
        info.code === null
          ? t("Process exited")
          : t("Process exited with code {code}", { code: info.code });
      s?.term.write(`\r\n\x1b[2m${msg}\x1b[0m\r\n`);
    },
  };
}

let tick = 0;
const shellSeen = new Map<string, number>();

/** Last time the shell itself was in the foreground of a pane. */
export const lastShellSeen = (id: string) => shellSeen.get(id) ?? 0;

/** Foreground process and cwd, polled: active tab every second, others every 3 s. */
export function startProcessPolling() {
  const poll = async () => {
    tick++;
    const s = ws();
    const active = activeTab(s);
    const ids = (tick % 3 === 0 ? s.tabs : active ? [active] : []).flatMap((x) => paneIds(x.root));
    await Promise.all(
      ids.map(async (id) => {
        const meta = ws().panes[id];
        if (!meta || meta.exited) return;
        try {
          const proc = await pty.info(id);
          if (!proc) return;
          const prev = meta.proc;
          const same =
            prev &&
            prev.pid === proc.pid &&
            prev.name === proc.name &&
            prev.cwd === proc.cwd &&
            prev.isShell === proc.isShell;
          const patch: Partial<typeof meta> = {};
          if (!same) patch.proc = proc;
          if (proc.isShell) shellSeen.set(id, Date.now());
          if (!meta.cwdFromOsc && proc.cwd && proc.isShell) patch.cwd = proc.cwd;
          if (Object.keys(patch).length) ws().updatePane(id, patch);
        } catch {
          /* pane closed meanwhile */
        }
      }),
    );
  };
  const timer = window.setInterval(() => void poll(), 1000);
  void poll();
  return () => window.clearInterval(timer);
}
