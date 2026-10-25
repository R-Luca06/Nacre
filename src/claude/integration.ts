import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { paneIds } from "../layout/tree";
import { t } from "../i18n";
import { useConfig } from "../store/config";
import { activeTab, tabOfPane, useWorkspace } from "../store/workspace";
import { type Attention, ackPane, initClaudeStore, sessionForPane, useClaude } from "./store";

const ws = () => useWorkspace.getState();

function ownsPane(pane: string | null): pane is string {
  return !!pane && !!ws().panes[pane];
}

function paneOnScreen(pane: string): boolean {
  const tab = activeTab();
  if (!tab || !document.hasFocus()) return false;
  return tab.zoomed ? tab.zoomed === pane : paneIds(tab.root).includes(pane);
}

let audio: AudioContext | null = null;
function chime() {
  audio ??= new AudioContext();
  const now = audio.currentTime;
  [660, 880].forEach((f, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.06, now + i * 0.09);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.18);
    osc.connect(gain).connect(audio!.destination);
    osc.start(now + i * 0.09);
    osc.stop(now + i * 0.09 + 0.2);
  });
}

function onAttention(a: Attention) {
  if (!ownsPane(a.paneId)) return;
  if (paneOnScreen(a.paneId)) {
    ackPane(a.paneId);
    return;
  }
  const c = useConfig.getState().config.claude;
  if (c.sound) chime();
  if (!c.notify) return;
  const title =
    a.kind === "permission"
      ? t("Claude needs approval")
      : a.kind === "input"
        ? t("Claude is waiting")
        : t("Claude is done");
  void invoke("notify", { title, body: [a.title, a.message].filter(Boolean).join(" — ") }).catch(
    () => {},
  );
}

/** Clears the attention flag once the user sees the pane. */
export function ackVisible() {
  const tab = activeTab();
  if (!tab || !document.hasFocus()) return;
  for (const p of tab.zoomed ? [tab.zoomed] : paneIds(tab.root)) {
    if (sessionForPane(p)?.attention) ackPane(p);
  }
}

const alerted = new Set<string>();

function watchContext() {
  useClaude.subscribe((s) => {
    const { context_alert } = useConfig.getState().config.claude;
    for (const c of s.sessions) {
      if (!ownsPane(c.paneId) || alerted.has(c.id) || c.contextPct < context_alert) continue;
      alerted.add(c.id);
      const tab = tabOfPane(c.paneId);
      ws().showToast(
        t("Context at {pct}% — compaction soon", { pct: Math.round(c.contextPct) }),
        "warn",
        tab?.id,
      );
    }
  });
}

export async function initClaude() {
  await initClaudeStore(onAttention);
  watchContext();
  const applyBadge = () =>
    void invoke("claude_badge", { enabled: useConfig.getState().config.claude.dock_badge }).catch(
      () => {},
    );
  applyBadge();
  useConfig.subscribe((s, prev) => {
    if (s.config.claude.dock_badge !== prev.config.claude.dock_badge) applyBadge();
  });
  void getCurrentWindow().onFocusChanged(({ payload }) => {
    if (payload) ackVisible();
  });
  useWorkspace.subscribe((s, prev) => {
    if (s.activeTabId !== prev.activeTabId || s.tabs !== prev.tabs) ackVisible();
  });
}
