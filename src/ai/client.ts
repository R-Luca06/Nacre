import { Channel, invoke } from "@tauri-apps/api/core";
import { useConfig } from "../store/config";
import { language } from "../i18n";

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface AiCall {
  promise: Promise<string>;
  cancel: () => void;
}

let next = 1;

/** Streams one answer; `onText` gets the text so far. */
export function ask(
  opts: { system: string; prompt: string; chat?: boolean; history?: Turn[]; cwd?: string },
  onText?: (text: string) => void,
): AiCall {
  const cfg = useConfig.getState().config.ai;
  const id = `ai${next++}`;
  let text = "";
  const ch = new Channel<{ type: string; text?: string; message?: string }>();
  const promise = new Promise<string>((resolve, reject) => {
    ch.onmessage = (e) => {
      if (e.type === "delta" && e.text) {
        text += e.text;
        onText?.(text);
      } else if (e.type === "done") resolve(e.text || text);
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
    },
    onEvent: ch,
  }).catch(() => {});
  return { promise, cancel: () => void invoke("ai_cancel", { id }) };
}

/** First fenced code block, or the whole answer without fences. */
export function extractCommand(answer: string): string {
  const fenced = /```(?:[a-z]*)\n([\s\S]*?)```/i.exec(answer);
  const raw = fenced ? fenced[1] : answer;
  return raw
    .replace(/^`+|`+$/g, "")
    .replace(/^\$\s+/gm, "")
    .trim();
}
