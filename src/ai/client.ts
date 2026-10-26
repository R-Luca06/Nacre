import { Channel, invoke } from "@tauri-apps/api/core";
import { useConfig } from "../store/config";
import { language } from "../i18n";

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

/** A tool call made while searching (`claude -p` only). */
export interface AiStep {
  name: string;
  input: Record<string, unknown>;
}

export interface AiCall {
  promise: Promise<string>;
  cancel: () => void;
}

let next = 1;

/** Streams one answer; `onText` gets the text so far. */
export function ask(
  opts: {
    system: string;
    prompt: string;
    chat?: boolean;
    history?: Turn[];
    cwd?: string;
    /** Let the model look through the user's files first. */
    search?: boolean;
    onStep?: (step: AiStep) => void;
  },
  onText?: (text: string) => void,
): AiCall {
  const cfg = useConfig.getState().config.ai;
  const id = `ai${next++}`;
  let text = "";
  const ch = new Channel<{
    type: string;
    text?: string;
    message?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>();
  const promise = new Promise<string>((resolve, reject) => {
    ch.onmessage = (e) => {
      if (e.type === "delta" && e.text) {
        text += e.text;
        onText?.(text);
      } else if (e.type === "reset") {
        text = "";
        onText?.(text);
      } else if (e.type === "tool" && e.name) opts.onStep?.({ name: e.name, input: e.input ?? {} });
      else if (e.type === "done") resolve(e.text || text);
      else if (e.type === "error") reject(new Error(e.message));
      else if (e.type === "cancelled") reject(new Error("cancelled"));
    };
  });
  const lang = language() === "fr" ? "French" : "English";
  void invoke("ai_run", {
    id,
    req: {
      system: `${opts.system}\nWrite any prose in ${lang}.`,
      prompt: opts.prompt,
      model: opts.chat ? cfg.chat_model : cfg.model,
      provider: cfg.provider,
      cwd: opts.cwd ?? null,
      claudePath: cfg.claude_path || null,
      history: opts.history ?? [],
      search: !!opts.search,
    },
    onEvent: ch,
  }).catch(() => {});
  return { promise, cancel: () => void invoke("ai_cancel", { id }) };
}

/** First fenced code block, or the answer without fences and without a prose lead-in. */
export function extractCommand(answer: string): string {
  const fenced = /```(?:[a-z]*)\n([\s\S]*?)```/i.exec(answer);
  // "Here is the command:\n\ncmd": the command is the last paragraph.
  const raw = fenced
    ? fenced[1]
    : (answer
        .trim()
        .split(/\n\s*\n/)
        .pop() ?? "");
  return raw
    .replace(/^`+|`+$/g, "")
    .replace(/^\$\s+/gm, "")
    .trim();
}
