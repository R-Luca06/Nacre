import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import { activeTab, useWorkspace } from "../store/workspace";
import { getSession } from "../terminal/registry";
import { newTab } from "./ops";

const ws = () => useWorkspace.getState();

/** Starts recording the active pane, or stops and saves to ~/Downloads as .cast. */
export async function toggleRecording() {
  const id = activeTab()?.active;
  const s = id ? getSession(id) : undefined;
  if (!id || !s || s.isReplay) return;
  if (!s.recording) {
    s.startRecording();
    ws().updatePane(id, { recording: true });
    return;
  }
  const cast = s.stopRecording();
  ws().updatePane(id, { recording: false });
  if (!cast) return;
  const bytes = new TextEncoder().encode(cast);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  try {
    const path = await invoke<string>("save_download", {
      name: `nacre-${stamp}.cast`,
      base64: btoa(bin),
    });
    ws().showToast(t("Saved to {path}", { path: path.replace(/^.*\/Downloads/, "~/Downloads") }));
  } catch (e) {
    ws().showToast(String(e), "warn");
  }
}

/** Picks a .cast file and plays it in a new tab. */
export function playRecording() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".cast,application/json";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    const text = await f.text();
    await newTab({ launch: { replay: text } });
    const tab = activeTab();
    if (tab) ws().updateTab(tab.id, { title: f.name.replace(/\.cast$/, "") });
  };
  input.click();
}
