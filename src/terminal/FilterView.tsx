import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { t } from "../i18n";
import { useWorkspace } from "../store/workspace";
import { getSession } from "./registry";
import { focusPane } from "../app/ops";

/** Grep over one command's output; clicking a line scrolls to it. */
export function FilterView({ paneId, blockId }: { paneId: string; blockId: number }) {
  const s = getSession(paneId);
  const b = s?.commands.blocks.find((x) => x.id === blockId);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const lines = useMemo(() => {
    if (!s || !b?.output) return [];
    const buf = s.term.buffer.active;
    const end = b.end ? b.end.line : buf.length;
    const out: { y: number; text: string }[] = [];
    for (let y = b.output.line; y < end; y++) {
      out.push({ y, text: buf.getLine(y)?.translateToString(true) ?? "" });
    }
    return out;
  }, [s, b]);
  const matches = useMemo(() => {
    if (!query) return lines;
    let re: RegExp | null = null;
    if (regex) {
      try {
        re = new RegExp(query, "i");
      } catch {
        return [];
      }
    }
    const q = query.toLowerCase();
    return lines.filter((l) => (re ? re.test(l.text) : l.text.toLowerCase().includes(q)));
  }, [lines, query, regex]);

  const close = () => {
    useWorkspace.getState().setOverlay(null);
    focusPane(paneId);
  };

  return (
    <div className="scrim" onMouseDown={close}>
      <div className="filter popover" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <input
            autoFocus
            value={query}
            placeholder={t("Filter")}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          />
          <button className={`icon-btn${regex ? " on" : ""}`} onClick={() => setRegex(!regex)}>
            .*
          </button>
          <span className="sub">
            {matches.length}/{lines.length}
          </span>
          <button className="icon-btn" onClick={close}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </header>
        <div className="sub cmd">$ {b?.command}</div>
        <pre>
          {matches.slice(0, 2000).map((l) => (
            <div
              key={l.y}
              onClick={() => {
                s?.term.scrollToLine(Math.max(0, l.y - 3));
                s?.term.selectLines(l.y, l.y);
                close();
              }}
            >
              {l.text || " "}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
