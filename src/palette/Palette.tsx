import { useEffect, useMemo, useRef, useState } from "react";
import { actions, actionLabel } from "../app/actions";
import { focusPane } from "../app/ops";
import { formatCombo } from "../keybindings/combo";
import { bindingsFor, runAction } from "../keybindings/runtime";
import { activeTab, useWorkspace } from "../store/workspace";
import { fuzzyFilter } from "../util/fuzzy";
import { t } from "../i18n";
import "./palette.css";

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Extra item sources (tabs, themes, snippets…) registered by other modules. */
const sources: (() => PaletteItem[])[] = [];
export function addPaletteSource(fn: () => PaletteItem[]) {
  sources.push(fn);
}

function actionItems(): PaletteItem[] {
  return actions
    .filter((a) => !a.hidden)
    .map((a) => {
      const keys = bindingsFor(a.id);
      return {
        id: a.id,
        label: actionLabel(a),
        hint: keys.length ? formatCombo(keys[0]) : undefined,
        run: () => void runAction(a.id, "palette"),
      };
    });
}

export function Palette() {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const all = useMemo(() => [...actionItems(), ...sources.flatMap((s) => s())], []);
  const items = useMemo(() => fuzzyFilter(all, query, (i) => i.label), [all, query]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const close = () => {
    useWorkspace.getState().setOverlay(null);
    const tab = activeTab();
    if (tab) focusPane(tab.active);
  };
  const choose = (item?: PaletteItem) => {
    if (!item) return;
    useWorkspace.getState().setOverlay(null);
    const tab = activeTab();
    if (tab) focusPane(tab.active);
    item.run();
  };

  return (
    <div className="scrim" onMouseDown={close}>
      <div className="palette popover" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={query}
          spellCheck={false}
          placeholder={t("Type a command")}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
              e.preventDefault();
              setIndex((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") choose(items[index]);
          }}
        />
        <div className="palette-list" ref={list}>
          {items.map((item, i) => (
            <div
              key={item.id}
              className={`palette-row${i === index ? " selected" : ""}`}
              onMouseMove={() => setIndex(i)}
              onClick={() => choose(item)}
            >
              <span>{item.label}</span>
              {item.hint && <span className="kbd">{item.hint}</span>}
            </div>
          ))}
          {items.length === 0 && <div className="palette-empty">{t("No results")}</div>}
        </div>
      </div>
    </div>
  );
}
