import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CaseSensitive, Regex, WholeWord, X } from "lucide-react";
import { getSession } from "./registry";
import { useWorkspace } from "../store/workspace";
import { t } from "../i18n";
import "./search.css";

export function SearchBar({ paneId }: { paneId: string }) {
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCase] = useState(false);
  const [wholeWord, setWhole] = useState(false);
  const [result, setResult] = useState({ index: -1, count: 0 });
  const input = useRef<HTMLInputElement>(null);
  const session = getSession(paneId);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    if (!session) return;
    const off = session.onSearchResults((index, count) => setResult({ index, count }));
    return () => {
      off();
      session.clearSearch();
    };
  }, [session]);

  const opts = { regex, caseSensitive, wholeWord };

  useEffect(() => {
    session?.find(query, { regex, caseSensitive, wholeWord, incremental: true });
  }, [session, query, regex, caseSensitive, wholeWord]);

  const close = () => {
    useWorkspace.getState().setSearch(null);
    session?.focus();
  };

  const next = (back = false) => session?.find(query, opts, back);

  return (
    <div className="searchbar popover" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        value={query}
        spellCheck={false}
        placeholder={t("Find")}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          else if (e.key === "Enter") next(e.shiftKey);
          else if (e.key === "g" && e.metaKey) {
            e.preventDefault();
            next(e.shiftKey);
          }
        }}
      />
      <span className="count">
        {query ? (result.count ? `${result.index + 1}/${result.count}` : t("No results")) : ""}
      </span>
      <button
        className={`icon-btn${caseSensitive ? " on" : ""}`}
        title={t("Match case")}
        onClick={() => setCase(!caseSensitive)}
      >
        <CaseSensitive size={14} strokeWidth={1.5} />
      </button>
      <button
        className={`icon-btn${wholeWord ? " on" : ""}`}
        title={t("Whole word")}
        onClick={() => setWhole(!wholeWord)}
      >
        <WholeWord size={14} strokeWidth={1.5} />
      </button>
      <button
        className={`icon-btn${regex ? " on" : ""}`}
        title={t("Regex")}
        onClick={() => setRegex(!regex)}
      >
        <Regex size={14} strokeWidth={1.5} />
      </button>
      <button className="icon-btn" title={t("Find Previous")} onClick={() => next(true)}>
        <ArrowUp size={14} strokeWidth={1.5} />
      </button>
      <button className="icon-btn" title={t("Find Next")} onClick={() => next()}>
        <ArrowDown size={14} strokeWidth={1.5} />
      </button>
      <button className="icon-btn" onClick={close}>
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
