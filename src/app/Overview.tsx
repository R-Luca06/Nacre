import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import { paneIds } from "../layout/tree";
import { useWorkspace } from "../store/workspace";
import { getSession } from "../terminal/registry";
import { selectTab } from "./ops";
import { tabTitle } from "./titles";
import "./overview.css";

/** Last non-empty lines on screen in the tab's active pane. */
function preview(paneId: string): string {
  const s = getSession(paneId);
  if (!s) return "";
  const b = s.term.buffer.active;
  const lines: string[] = [];
  for (let y = b.viewportY; y < b.viewportY + s.term.rows; y++)
    lines.push(b.getLine(y)?.translateToString(true) ?? "");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(-12).join("\n");
}

/** Every tab as a card; arrows and Enter, or a click, to switch. */
export function Overview() {
  const tabs = useWorkspace((s) => s.tabs);
  const panes = useWorkspace((s) => s.panes);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      tabs.findIndex((x) => x.id === activeTabId),
    ),
  );
  const texts = useMemo(() => tabs.map((tab) => preview(tab.active)), [tabs]);
  const close = () => useWorkspace.getState().setOverlay(null);
  const pick = (id: string) => {
    close();
    selectTab(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cols = Math.max(1, Math.floor((window.innerWidth - 48) / 296));
      const step: Record<string, number> = {
        ArrowRight: 1,
        ArrowLeft: -1,
        ArrowDown: cols,
        ArrowUp: -cols,
        Tab: e.shiftKey ? -1 : 1,
      };
      if (e.key === "Escape") close();
      else if (e.key === "Enter" && tabs[index]) pick(tabs[index].id);
      else if (e.key in step)
        setIndex((i) => Math.min(tabs.length - 1, Math.max(0, i + step[e.key])));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="scrim overview" onMouseDown={close}>
      <div className="overview-grid" onMouseDown={(e) => e.stopPropagation()}>
        {tabs.map((tab, i) => {
          const n = paneIds(tab.root).length;
          return (
            <button
              key={tab.id}
              className={`overview-card${i === index ? " selected" : ""}${tab.id === activeTabId ? " current" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => pick(tab.id)}
            >
              <pre className="overview-text">{texts[i]}</pre>
              <span className="overview-title">
                {tabTitle(tab, panes)}
                {n > 1 && <span className="overview-count">{t("{n} panes", { n })}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
