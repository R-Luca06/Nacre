import { useState } from "react";
import type { PromptRequest } from "../store/workspace";
import { activeTab, useWorkspace } from "../store/workspace";
import { focusPane } from "./ops";
import { t } from "../i18n";

export function PromptDialog({ prompt }: { prompt: PromptRequest }) {
  const [value, setValue] = useState(prompt.value ?? "");
  const close = (submit: boolean) => {
    useWorkspace.getState().setOverlay(null);
    const tab = activeTab();
    if (tab) focusPane(tab.active);
    if (submit && value.trim()) prompt.onSubmit(value.trim());
  };
  return (
    <div className="scrim" onMouseDown={() => close(false)}>
      <div className="confirm popover" onMouseDown={(e) => e.stopPropagation()}>
        <div className="confirm-title">{prompt.title}</div>
        <input
          className="prompt-input"
          autoFocus
          value={value}
          placeholder={prompt.placeholder}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") close(true);
            if (e.key === "Escape") close(false);
          }}
        />
        <div className="confirm-actions">
          <button className="btn" onClick={() => close(false)}>
            {t("Cancel")}
          </button>
          <button className="btn primary" onClick={() => close(true)}>
            {prompt.action}
          </button>
        </div>
      </div>
    </div>
  );
}
