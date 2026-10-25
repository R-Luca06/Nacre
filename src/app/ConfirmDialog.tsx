import { useEffect, useRef } from "react";
import type { Confirm } from "../store/workspace";
import { activeTab, useWorkspace } from "../store/workspace";
import { focusPane } from "./ops";
import { t } from "../i18n";

export function ConfirmDialog({ confirm }: { confirm: Confirm }) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), []);
  const close = (accept: boolean) => {
    useWorkspace.getState().setOverlay(null);
    if (accept) confirm.onConfirm();
    const tab = activeTab();
    if (tab) focusPane(tab.active);
  };
  return (
    <div
      className="scrim"
      onMouseDown={() => close(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") close(false);
      }}
    >
      <div className="confirm popover" onMouseDown={(e) => e.stopPropagation()}>
        <div className="confirm-title">{confirm.title}</div>
        <div className={`confirm-detail${confirm.detail.includes("\n") ? " mono" : ""}`}>
          {confirm.detail}
        </div>
        <div className="confirm-actions">
          <button className="btn" onClick={() => close(false)}>
            {t("Cancel")}
          </button>
          <button ref={ok} className="btn primary" onClick={() => close(true)}>
            {confirm.action}
          </button>
        </div>
      </div>
    </div>
  );
}
