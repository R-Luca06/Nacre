import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import * as pty from "../ipc/pty";
import type { ProcInfo } from "../ipc/pty";
import { detectClaude, releasePane, sessionForPane } from "../claude/store";
import { paneIds } from "../layout/tree";
import { t } from "../i18n";
import { handleKeyEvent } from "../keybindings/runtime";
import { useConfig } from "../store/config";
import { activeTab, tabOfPane, useWorkspace } from "../store/workspace";
import { getSession } from "../terminal/registry";
import type { SessionEvents } from "../terminal/session";
import { beep, ring } from "./bell";
import { invoke } from "@tauri-apps/api/core";
import { fmtMs } from "../terminal/blocks";
import { closePane, focusPane, lookOf } from "./ops";
import { setPaneLook } from "../terminal/registry";
import { autoProfile, sshHost } from "../config/profiles";
import { homeDir } from "./paths";

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
    cwd: () => ws().panes[id]?.cwd,
    onTrigger: (rule, m, line) => {
      if (rule.action === "notify") {
        void invoke("notify", { title: t("Trigger"), body: line.trim().slice(0, 200) }).catch(
          () => {},
        );
      } else if (rule.action === "sound") {
        beep();
      } else if (rule.action === "command" && rule.command) {
        const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
        const command = rule.command.replace(/\$(\d)/g, (_, n: string) => q(m[Number(n)] ?? ""));
        void invoke("run_script", {
          command,
          cwd: ws().panes[id]?.cwd ?? null,
          timeout: 30000,
        }).catch(() => {});
      }
    },
    openFile: (file, line, col) =>
      void invoke("open_in_editor", {
        template: useConfig.getState().config.general.editor,
        file,
        line: line ?? null,
        col: col ?? null,
      }).catch((e) => ws().showToast(String(e), "warn")),
    onCwd: (cwd) => {
      if (ws().panes[id]?.cwd !== cwd) void invoke("dirs_visit", { path: cwd }).catch(() => {});
      ws().updatePane(id, { cwd, cwdFromOsc: true });
    },
    onCommandFinished: (b) => {
      const duration = (b.finishedAt ?? 0) - (b.startedAt ?? 0);
      if (b.command) {
        void invoke("history_add", {
          command: b.command,
          cwd: ws().panes[id]?.cwd ?? null,
          exit: b.exitCode ?? null,
        }).catch(() => {});
      }
      ws().updatePane(id, {
        lastCommand: { command: b.command, duration, exitCode: b.exitCode, at: Date.now() },
      });
      // 130: interrupted with Ctrl-C, not worth a suggestion.
      if (
        b.exitCode &&
        b.exitCode !== 130 &&
        useConfig.getState().config.ai.auto_fix &&
        isVisible(id)
      ) {
        ws().setAi({ paneId: id, mode: "fix", blockId: b.id });
      }
      const after = useConfig.getState().config.terminal.notify_after;
      if (after > 0 && duration >= after * 1000 && !isVisible(id)) {
        const cmd = (b.command ?? "").split("\n")[0].slice(0, 80);
        void invoke("notify", {
          title: b.exitCode ? t("Command failed") : t("Command finished"),
          body: `${cmd} · ${fmtMs(duration)}`,
        }).catch(() => {});
      }
    },
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

/** Profiles with `match_dirs` / `match_ssh` restyle panes that have no explicit profile. */
function trackLook(id: string, proc: ProcInfo) {
  const meta = ws().panes[id];
  if (!meta || meta.profile || tabOfPane(id)?.theme) return;
  const profiles = useConfig.getState().config.profiles;
  if (!Object.keys(profiles).length) {
    setPaneLook(id, undefined);
    return;
  }
  const host = proc.name === "ssh" ? sshHost(proc.args) : undefined;
  const p = autoProfile(profiles, { cwd: meta.cwd, sshHost: host, home: homeDir() });
  setPaneLook(id, lookOf(p));
}

let tick = 0;
const lastDetect = new Map<string, number>();

/** Fallback when hooks are not installed: `claude` in the foreground means a session. */
function trackClaude(id: string, proc: ProcInfo) {
  const session = sessionForPane(id);
  if (proc.isShell) {
    if (session) releasePane(id);
    return;
  }
  if (proc.name !== "claude" || session || !proc.cwd) return;
  const last = lastDetect.get(id) ?? 0;
  if (Date.now() - last < 5000) return;
  lastDetect.set(id, Date.now());
  void detectClaude(id, proc.cwd);
}
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
          trackClaude(id, proc);
          trackLook(id, proc);
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
