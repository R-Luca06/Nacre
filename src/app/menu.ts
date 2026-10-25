import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t } from "../i18n";
import { bindingsFor, onBindingsChange, runAction } from "../keybindings/runtime";
import { actionById } from "./actions";

type Entry =
  | { kind: "item"; id: string; label: string; accel?: string }
  | { kind: "separator" }
  | { kind: "predefined"; name: string; label?: string }
  | { kind: "submenu"; label: string; items: Entry[]; window?: boolean };

const NAMED: Record<string, string> = {
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  enter: "Enter",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  tab: "Tab",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  " ": "Space",
};

const MODS: Record<string, string> = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Cmd" };

/** `shift+cmd+t` → `Shift+Cmd+T`; chords have no menu equivalent. */
export function toAccelerator(combo: string): string | undefined {
  if (combo.includes(" ")) return undefined;
  const parts = combo.endsWith("++") ? [...combo.slice(0, -2).split("+"), "+"] : combo.split("+");
  const key = parts.pop()!;
  const k =
    NAMED[key] ??
    (/^f\d+$/.test(key) ? key.toUpperCase() : key.length === 1 ? key.toUpperCase() : null);
  if (!k || k === "+") return undefined;
  return [...parts.map((m) => MODS[m]), k].join("+");
}

const item = (id: string): Entry => {
  const a = actionById.get(id);
  return {
    kind: "item",
    id,
    label: a ? t(a.label) : id,
    accel: bindingsFor(id)
      .map(toAccelerator)
      .find((x) => x),
  };
};
const sep: Entry = { kind: "separator" };
const pre = (name: string, label?: string): Entry => ({ kind: "predefined", name, label });

function spec(): Entry[] {
  return [
    {
      kind: "submenu",
      label: "Nacre",
      items: [
        pre("about", t("About Nacre")),
        sep,
        item("app.settings"),
        item("app.openConfig"),
        sep,
        pre("services", t("Services")),
        sep,
        pre("hide", t("Hide Nacre")),
        pre("hideOthers", t("Hide Others")),
        pre("showAll", t("Show All")),
        sep,
        item("app.quit"),
      ],
    },
    {
      kind: "submenu",
      label: t("Shell"),
      items: [
        item("tab.new"),
        item("window.new"),
        sep,
        item("pane.splitRight"),
        item("pane.splitDown"),
        sep,
        item("tab.duplicate"),
        item("tab.reopen"),
        sep,
        item("pane.close"),
        item("tab.close"),
        item("window.close"),
      ],
    },
    {
      kind: "submenu",
      label: t("Edit"),
      items: [
        pre("undo", t("Undo")),
        pre("redo", t("Redo")),
        sep,
        pre("cut", t("Cut")),
        item("edit.copy"),
        item("edit.paste"),
        item("edit.selectAll"),
        sep,
        item("edit.find"),
        item("edit.clear"),
      ],
    },
    {
      kind: "submenu",
      label: t("View"),
      items: [
        item("app.palette"),
        sep,
        item("view.zoomIn"),
        item("view.zoomOut"),
        item("view.zoomReset"),
        sep,
        item("pane.zoom"),
        item("pane.equalize"),
        item("pane.broadcast"),
        sep,
        item("window.fullscreen"),
      ],
    },
    {
      kind: "submenu",
      label: t("Window"),
      window: true,
      items: [
        pre("minimize", t("Minimize")),
        pre("zoom", t("Zoom")),
        sep,
        item("tab.next"),
        item("tab.prev"),
        item("tab.rename"),
        item("tab.pin"),
        sep,
        item("window.onTop"),
      ],
    },
  ];
}

let timer = 0;
function publish() {
  clearTimeout(timer);
  timer = window.setTimeout(() => void invoke("menu_set", { entries: spec() }).catch(() => {}), 50);
}

export function initMenu() {
  publish();
  onBindingsChange(publish);
  void listen<string>("menu-action", (e) => void runAction(e.payload, "menu"));
}

export const refreshMenu = publish;
