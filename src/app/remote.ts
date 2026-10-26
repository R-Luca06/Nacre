import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWorkspace } from "../store/workspace";
import { focusPane, newTab, splitPane } from "./ops";

interface Remote {
  cmd: "new-tab" | "split" | "focus-pane";
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
    }
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
  });
}
