import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getSession } from "../terminal/registry";
import { activeTab } from "../store/workspace";
import { focusPane } from "./ops";

const quote = (p: string) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);

/** Files dropped on a pane are typed as escaped paths. */
export function initDragDrop() {
  void getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type !== "drop") return;
    const { x, y } = e.payload.position;
    const scale = window.devicePixelRatio || 1;
    const el = document.elementFromPoint(x / scale, y / scale);
    const paneId =
      (el?.closest("[data-pane]") as HTMLElement | null)?.dataset.pane ?? activeTab()?.active;
    if (!paneId) return;
    getSession(paneId)?.send(e.payload.paths.map(quote).join(" ") + " ");
    focusPane(paneId);
  });
}
