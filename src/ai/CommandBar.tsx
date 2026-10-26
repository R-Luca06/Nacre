import { useEffect, useRef, useState } from "react";
import { Asterisk, CornerDownLeft, X } from "lucide-react";
import { t } from "../i18n";
import { useWorkspace } from "../store/workspace";
import { getSession } from "../terminal/registry";
import { isDangerousPaste } from "../app/paths";
import { focusPane } from "../app/ops";
import { formatCombo } from "../keybindings/combo";
import { type AiCall, ask, extractCommand } from "./client";
import {
  COMMAND_SYSTEM,
  EXPLAIN_SYSTEM,
  FIX_SYSTEM,
  SUMMARY_SYSTEM,
  blockText,
  describeContext,
  paneContext,
  screenText,
} from "./context";
import { Markdown } from "./Markdown";
import "./ai.css";

export type AiMode = "command" | "explain" | "summarize" | "fix";

export interface AiRequestState {
  paneId: string;
  mode: AiMode;
  blockId?: number;
}

const close = (paneId: string) => {
  useWorkspace.getState().setAi(null);
  focusPane(paneId);
};

/** Puts text on the prompt line; `run` presses Enter too. */
function insert(paneId: string, cmd: string, run: boolean) {
  const s = getSession(paneId);
  if (!s) return;
  // Clear whatever is typed (Ctrl-U), then type the command.
  s.send("\x15" + cmd.replace(/\n/g, " ") + (run ? "\r" : ""));
  close(paneId);
}

function useAnswer() {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const call = useRef<AiCall | null>(null);
  const start = (c: AiCall) => {
    call.current?.cancel();
    call.current = c;
    setBusy(true);
    setError("");
    setAnswer("");
    c.promise.then(
      (text) => {
        setAnswer(text);
        setBusy(false);
      },
      (e: Error) => {
        if (e.message !== "cancelled") setError(e.message);
        setBusy(false);
      },
    );
  };
  useEffect(() => () => call.current?.cancel(), []);
  return { answer, setAnswer, busy, error, start };
}

/** ⌘K: describe what you want, review the command, then run it. */
function CommandMode({ paneId }: { paneId: string }) {
  const [query, setQuery] = useState("");
  const { answer, setAnswer, busy, error, start } = useAnswer();
  const input = useRef<HTMLInputElement>(null);
  const asked = useRef("");
  const command = extractCommand(answer);
  const impossible = command.startsWith("#");
  const risky = !impossible && isDangerousPaste(command);

  const submit = () => {
    if (!query.trim()) return;
    const ctx = paneContext(paneId);
    start(
      ask(
        {
          system: COMMAND_SYSTEM,
          prompt: `${describeContext(ctx)}\n\nRequest: ${query}`,
          cwd: ctx.cwd,
        },
        setAnswer,
      ),
    );
  };

  useEffect(() => input.current?.focus(), []);

  return (
    <div
      className="ai-bar popover"
      onKeyDown={(e) => {
        if (e.key === "Escape") close(paneId);
        if (
          e.key === "Enter" &&
          !busy &&
          command &&
          !impossible &&
          document.activeElement !== input.current
        ) {
          e.preventDefault();
          insert(paneId, command, !e.metaKey);
        }
      }}
    >
      <div className="ai-row">
        <Asterisk size={14} strokeWidth={1.5} className={`ai-mark${busy ? " busy" : ""}`} />
        <input
          ref={input}
          value={query}
          placeholder={t("Describe a command")}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              // Enter asks; Enter again (same text) runs, ⌘Enter inserts.
              if (command && !busy && !impossible && query === asked.current) {
                insert(paneId, command, !e.metaKey);
              } else {
                asked.current = query;
                submit();
              }
            }
            if (e.key === "Escape") close(paneId);
          }}
        />
        <button className="icon-btn" onClick={() => close(paneId)}>
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      {(command || error) && (
        <div className={`ai-proposal${risky ? " risky" : ""}${impossible ? " impossible" : ""}`}>
          {error ? (
            <span className="ai-error">{error}</span>
          ) : (
            <>
              <pre>{impossible ? command.replace(/^#\s*/, "") : command}</pre>
              {!busy && !impossible && (
                <span className="ai-actions">
                  {risky && <span className="ai-warn">{t("Check before running")}</span>}
                  <button className="btn" onClick={() => insert(paneId, command, false)}>
                    {t("Insert")} <span className="kbd">{formatCombo("cmd+enter")}</span>
                  </button>
                  <button className="btn primary" onClick={() => insert(paneId, command, true)}>
                    {t("Run")} <CornerDownLeft size={12} strokeWidth={1.5} />
                  </button>
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Explain / summarize / fix: streamed answer about one command block. */
function AnswerMode({ paneId, mode, blockId }: AiRequestState) {
  const { answer, setAnswer, busy, error, start } = useAnswer();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ctx = paneContext(paneId);
    const s = ctx.session;
    const b =
      (blockId !== undefined && s?.commands.blocks.find((x) => x.id === blockId)) ||
      (mode === "summarize"
        ? s?.commands.lastFinished()
        : [...(s?.commands.blocks ?? [])].reverse().find((x) => x.exitCode));
    const subject = b ? blockText(ctx, b) : screenText(ctx);
    const system =
      mode === "explain" ? EXPLAIN_SYSTEM : mode === "summarize" ? SUMMARY_SYSTEM : FIX_SYSTEM;
    const ask_ =
      mode === "explain"
        ? "Explain this error."
        : mode === "summarize"
          ? "Summarize this output."
          : "Fix this command.";
    start(
      ask(
        { system, prompt: `${describeContext(ctx)}\n\n${subject}\n\n${ask_}`, cwd: ctx.cwd },
        setAnswer,
      ),
    );
    ref.current?.focus();
    // Runs once per request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fix = mode === "fix" ? extractCommand(answer) : "";
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="ai-bar popover answer"
      onKeyDown={(e) => {
        if (e.key === "Escape") close(paneId);
        if (e.key === "Enter" && fix && !fix.startsWith("#") && !busy)
          insert(paneId, fix, !e.metaKey);
      }}
    >
      <div className="ai-row">
        <Asterisk size={14} strokeWidth={1.5} className={`ai-mark${busy ? " busy" : ""}`} />
        <span className="ai-title">
          {t(
            mode === "explain"
              ? "Explain Error"
              : mode === "summarize"
                ? "Summarize Output"
                : "Suggest Fix",
          )}
        </span>
        <button className="icon-btn" onClick={() => close(paneId)}>
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="ai-answer">
        {error ? (
          <span className="ai-error">{error}</span>
        ) : mode === "fix" ? (
          fix && <pre className="ai-fix">{fix.startsWith("#") ? t("No fix found.") : fix}</pre>
        ) : (
          <Markdown
            text={answer}
            onCode={(code) =>
              !busy && (
                <button className="btn" onClick={() => insert(paneId, code, false)}>
                  {t("Insert")}
                </button>
              )
            }
          />
        )}
      </div>
      {mode === "fix" && fix && !fix.startsWith("#") && !busy && (
        <div className="ai-actions end">
          <button className="btn" onClick={() => insert(paneId, fix, false)}>
            {t("Insert")}
          </button>
          <button className="btn primary" onClick={() => insert(paneId, fix, true)}>
            {t("Run")} <CornerDownLeft size={12} strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}

export function AiBar(props: AiRequestState) {
  return props.mode === "command" ? (
    <CommandMode paneId={props.paneId} />
  ) : (
    <AnswerMode {...props} />
  );
}
