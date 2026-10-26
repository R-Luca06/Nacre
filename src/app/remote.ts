import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWorkspace } from "../store/workspace";
import { focusPane, newTab, splitPane } from "./ops";
import { openWorkspace, useWorkspaces } from "./workspaces";
import { receiveTab } from "./moveTab";

interface Remote {
  cmd: "new-tab" | "split" | "focus-pane" | "open-workspace" | "attach-tab";
  file?: string;
  pane?: string | null;
  cwd?: string | null;
  command?: string | null;
  side?: "right" | "down";
}

/** Requests from the `nacre` CLI and other windows, routed here by the backend. */
export function initRemote() {
  void listen<Remote>("remote", async (e) => {
    const r = e.payload;
    const opts = { cwd: r.cwd ?? undefined, command: r.command ?? undefined };
    if (r.cmd === "new-tab") {
      await newTab(opts);
    } else if (r.cmd === "split") {
      if (r.pane && useWorkspace.getState().panes[r.pane]) focusPane(r.pane);
      await splitPane(r.side ?? "right", opts);
    } else if (r.cmd === "focus-pane" && r.pane) {
      focusPane(r.pane);
    } else if (r.cmd === "attach-tab" && r.file) {
      await receiveTab(r.file);
    } else if (r.cmd === "open-workspace" && r.file) {
      const w = useWorkspaces.getState().list.find((x) => x.file === r.file);
      if (w) openWorkspace(w);
    }
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
  });
}
