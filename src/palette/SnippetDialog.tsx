import { useState } from "react";
import { fillSnippet, snippetParams } from "../config/snippets";
import { activeTab, useWorkspace } from "../store/workspace";
import { focusPane } from "../app/ops";
import { t } from "../i18n";
import { typeInActivePane } from "./Palette";

export function SnippetDialog({
  name,
  template,
  run,
}: {
  name: string;
  template: string;
  run: boolean;
}) {
  const params = snippetParams(template);
  const [values, setValues] = useState<Record<string, string>>({});
  const close = (submit: boolean) => {
    useWorkspace.getState().setOverlay(null);
    const tab = activeTab();
    if (tab) focusPane(tab.active);
    if (submit) typeInActivePane(fillSnippet(template, values), run);
  };
  return (
    <div className="scrim" onMouseDown={() => close(false)}>
      <div className="confirm popover" onMouseDown={(e) => e.stopPropagation()}>
        <div className="confirm-title">{name}</div>
        <div className="confirm-detail mono">{fillSnippet(template, values)}</div>
        {params.map((p, i) => (
          <input
            key={p.name}
            className="prompt-input"
            autoFocus={i === 0}
            placeholder={p.default ? `${p.name} (${p.default})` : p.name}
            spellCheck={false}
            value={values[p.name] ?? ""}
            onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") close(true);
              if (e.key === "Escape") close(false);
            }}
          />
        ))}
        <div className="confirm-actions">
          <button className="btn" onClick={() => close(false)}>
            {t("Cancel")}
          </button>
          <button className="btn primary" onClick={() => close(true)}>
            {run ? t("Run") : t("Insert")}
          </button>
        </div>
      </div>
    </div>
  );
}
