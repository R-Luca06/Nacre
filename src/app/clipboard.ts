import { writeText } from "@tauri-apps/plugin-clipboard-manager";

const MAX = 50;
const history: { text: string; at: number }[] = [];

/** Copies and remembers it for the clipboard history (memory only, never written to disk). */
export function copyText(text: string): Promise<void> {
  if (text && text.length < 100_000) {
    const i = history.findIndex((h) => h.text === text);
    if (i >= 0) history.splice(i, 1);
    history.unshift({ text, at: Date.now() });
    history.length = Math.min(history.length, MAX);
  }
  return writeText(text);
}

export const clipboardHistory = () => [...history];
