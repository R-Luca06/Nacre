import { activeTab, useWorkspace } from "../store/workspace";
import { getSession } from "../terminal/registry";
import type { Block } from "../terminal/blocks";

const tail = (text: string, lines: number, chars = 6000) => {
  const t = text.split("\n").slice(-lines).join("\n");
  return t.length > chars ? t.slice(-chars) : t;
};

export function paneContext(paneId = activeTab()?.active) {
  const meta = paneId ? useWorkspace.getState().panes[paneId] : undefined;
  const s = paneId ? getSession(paneId) : undefined;
  const shell = (meta?.launch.shell ?? "zsh").split("/").pop();
  const recent = (s?.commands.blocks ?? [])
    .filter((b) => b.command)
    .slice(-5)
    .map((b) => `${b.command}${b.exitCode ? `  # exit ${b.exitCode}` : ""}`);
  return { cwd: meta?.cwd, shell, recent, session: s };
}

export function describeContext(c: ReturnType<typeof paneContext>): string {
  const lines = [`OS: macOS`, `Shell: ${c.shell}`];
  if (c.cwd) lines.push(`Directory: ${c.cwd}`);
  if (c.recent.length) lines.push(`Recent commands:\n${c.recent.join("\n")}`);
  return lines.join("\n");
}

export function blockText(c: ReturnType<typeof paneContext>, b: Block, lines = 120): string {
  const out = c.session ? tail(c.session.commands.outputText(b), lines) : "";
  return `$ ${b.command ?? ""}\n${out}${b.exitCode ? `\n[exit ${b.exitCode}]` : ""}`;
}

/** Visible screen text when there is no shell integration. */
export function screenText(c: ReturnType<typeof paneContext>, lines = 80): string {
  const t = c.session?.term;
  if (!t) return "";
  const buf = t.buffer.active;
  const out: string[] = [];
  const end = buf.baseY + t.rows;
  for (let y = Math.max(0, end - lines); y < end; y++)
    out.push(buf.getLine(y)?.translateToString(true) ?? "");
  return out.join("\n").trimEnd();
}

export const COMMAND_SYSTEM = `You turn a request into one shell command for the user's terminal.
Reply with the command only: no explanation, no markdown fences, no leading "$".
Prefer portable, safe flags. If several steps are needed, join them with && on one line.
If the request is impossible or unclear, reply with a single line starting with "#" that says why.`;

/** Appended to COMMAND_SYSTEM when the model can look at files (`claude -p`). */
export const COMMAND_SEARCH = `You can look at the user's files, read-only. When the request names a file, folder, script or project you have not seen, find it first:
- \`mdfind -name <word> -onlyin ~\` (Spotlight, instant). Names are often lowercase or hyphenated: "My App" may be my-app. One command per call, no pipes.
- \`ls\`, Glob and Read for what is inside. Never search the whole disk.
Before running a script, read its first lines: use the interpreter of its shebang, or run it directly if it is executable. Use absolute paths, or cd into the project first if the script expects it.
Tools are for looking only: never run the command yourself, the user runs it.
A few lookups, then the answer. The final reply is still the command only.`;

export const EXPLAIN_SYSTEM = `You explain terminal errors briefly.
At most 6 short lines:
what went wrong, then how to fix it. If one command fixes it, end with it in a \`\`\`sh block.`;

export const SUMMARY_SYSTEM = `You summarize terminal output in at most 5 short bullet points.
Keep numbers, file names and errors.`;

export const FIX_SYSTEM = `A shell command failed. Reply with the corrected command only (no prose, no fences).
If you cannot correct it, reply with a single "#".`;

export const CHAT_SYSTEM = `You are a concise assistant inside the user's terminal (Nacre).
Answer briefly. Put commands in \`\`\`sh blocks. Use the terminal context when relevant.`;
