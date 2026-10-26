import { useEffect, useRef, useState } from "react";
import { Asterisk, Trash2 } from "lucide-react";
import { t } from "../i18n";
import { activeTab, useWorkspace } from "../store/workspace";
import { getSession } from "../terminal/registry";
import { type AiCall, type Turn, ask } from "./client";
import { CHAT_SYSTEM, blockText, describeContext, paneContext, screenText } from "./context";
import { Markdown } from "./Markdown";
import "./ai.css";

type Include = "dir" | "command" | "screen";

/** Chat beside the panes; each message can carry the active pane's context. */
export function ChatPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [include, setInclude] = useState<Set<Include>>(new Set(["dir", "command"]));
  const call = useRef<AiCall | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => () => call.current?.cancel(), []);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [turns, streaming]);

  const send = () => {
    const text = draft.trim();
    if (!text || streaming !== null) return;
    const ctx = paneContext();
    const parts: string[] = [];
    if (include.has("dir"))
      parts.push(describeContext({ ...ctx, recent: include.has("command") ? ctx.recent : [] }));
    if (include.has("command")) {
      const b = ctx.session?.commands.lastFinished();
      if (b) parts.push(`Last command:\n${blockText(ctx, b, 60)}`);
    }
    if (include.has("screen")) parts.push(`Screen:\n${screenText(ctx, 60)}`);
    const prompt = parts.length ? `${parts.join("\n\n")}\n\n${text}` : text;
    const history = turns;
    setTurns([...turns, { role: "user", text }]);
    setDraft("");
    setError("");
    setStreaming("");
    call.current = ask({ system: CHAT_SYSTEM, prompt, history, chat: true, cwd: ctx.cwd }, (x) =>
      setStreaming(x),
    );
    call.current.promise.then(
      (answer) => {
        setTurns((ts) => [...ts, { role: "assistant", text: answer }]);
        setStreaming(null);
      },
      (e: Error) => {
        if (e.message !== "cancelled") setError(e.message);
        setStreaming(null);
      },
    );
  };

  const insert = (code: string) => {
    const id = activeTab()?.active;
    const s = id ? getSession(id) : undefined;
    if (!s) return;
    s.send("\x15" + code.replace(/\n/g, " "));
    s.focus();
  };

  const toggle = (k: Include) => {
    const next = new Set(include);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setInclude(next);
  };

  const codeButton = (code: string) => (
    <button className="btn" onClick={() => insert(code)}>
      {t("Insert")}
    </button>
  );

  return (
    <aside className="chat-panel">
      <header>
        <Asterisk size={14} strokeWidth={1.5} className="ai-mark" />
        <span className="ai-title">{t("AI Chat")}</span>
        <button
          className="icon-btn"
          title={t("Clear")}
          onClick={() => {
            call.current?.cancel();
            setTurns([]);
            setStreaming(null);
          }}
        >
          <Trash2 size={12} strokeWidth={1.5} />
        </button>
      </header>
      <div className="chat-list" ref={list}>
        {turns.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.role === "user" ? m.text : <Markdown text={m.text} onCode={codeButton} />}
          </div>
        ))}
        {streaming !== null && (
          <div className="chat-msg assistant">
            {streaming ? <Markdown text={streaming} /> : <span className="dim">…</span>}
          </div>
        )}
        {error && <div className="chat-msg error">{error}</div>}
      </div>
      <div className="chat-context">
        {(
          [
            ["dir", "Directory"],
            ["command", "Last command"],
            ["screen", "Screen"],
          ] as [Include, string][]
        ).map(([k, label]) => (
          <button key={k} className={include.has(k) ? "on" : ""} onClick={() => toggle(k)}>
            {t(label)}
          </button>
        ))}
      </div>
      <textarea
        className="chat-input"
        value={draft}
        rows={3}
        placeholder={t("Ask about this terminal")}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape") {
            useWorkspace.getState().togglePanel("chat");
          }
        }}
      />
    </aside>
  );
}
