import { useState } from "react";
import { t } from "../i18n";
import { useWorkspace } from "../store/workspace";
import { focusPane } from "../app/ops";
import { getSession } from "./registry";

/** Edits the command at the prompt in a text area: several lines, mouse, selection. */
export function CommandEditor({ paneId, text }: { paneId: string; text: string }) {
  const [value, setValue] = useState(text);
  const close = (mode: "cancel" | "insert" | "run") => {
    useWorkspace.getState().setOverlay(null);
    focusPane(paneId);
    const s = getSession(paneId);
    if (!s || mode === "cancel") return;
    // End of line, then erase it, so the edited text replaces what was typed.
    s.send("\x05\x15");
    s.paste(value);
    if (mode === "run") s.send("\r");
  };
  return (
    <div className="scrim" onMouseDown={() => close("cancel")}>
      <div className="confirm popover editor" onMouseDown={(e) => e.stopPropagation()}>
        <textarea
          className="editor-text"
          autoFocus
          spellCheck={false}
          value={value}
          rows={Math.min(16, Math.max(4, value.split("\n").length + 1))}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close("cancel");
            if (e.key === "Enter" && e.metaKey) close(e.shiftKey ? "insert" : "run");
          }}
        />
        <div className="confirm-actions">
          <button className="btn" onClick={() => close("insert")} title="⇧⌘↩">
            {t("Insert")}
          </button>
          <button className="btn primary" onClick={() => close("run")} title="⌘↩">
            {t("Run")}
          </button>
        </div>
      </div>
    </div>
  );
}
