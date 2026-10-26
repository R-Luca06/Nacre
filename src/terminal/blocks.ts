import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";

/** One prompt + command + output, delimited by OSC 133 marks. */
export interface Block {
  id: number;
  prompt: IMarker;
  input?: IMarker;
  /** Column where typing starts on the `input` line. */
  inputX?: number;
  output?: IMarker;
  end?: IMarker;
  command?: string;
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number;
  decorations: IDecoration[];
}

export interface BlockOptions {
  marks: boolean;
  separators: boolean;
}

const MAX_BLOCKS = 500;

/** `echo\\nfoo` → real newlines; the shell escapes them to keep the OSC on one line. */
export function unescapeCommand(s: string): string {
  return s.replace(/\\n/g, "\n");
}

export class CommandTracker {
  readonly blocks: Block[] = [];
  private next = 1;
  private listeners = new Set<() => void>();

  constructor(
    private term: Terminal,
    private opts: () => BlockOptions,
    private onFinish: (b: Block) => void,
  ) {}

  get active(): boolean {
    return this.blocks.length > 0;
  }

  /** What is typed at the prompt, when the cursor sits at its end; null outside a prompt. */
  currentInput(): { text: string; y: number; x: number } | null {
    const b = this.blocks.at(-1);
    if (!b?.input || b.output || b.input.isDisposed || b.inputX === undefined) return null;
    const buf = this.term.buffer.active;
    if (buf.type !== "normal") return null;
    const y = buf.baseY + buf.cursorY;
    const x = buf.cursorX;
    if (y < b.input.line || y - b.input.line > 20) return null;
    let text = "";
    for (let row = b.input.line; row <= y; row++) {
      const line = buf.getLine(row);
      if (!line) return null;
      text += line.translateToString(
        false,
        row === b.input.line ? b.inputX : 0,
        row === y ? x : undefined,
      );
    }
    // Something after the cursor (mid-line edit, or the shell's own suggestion): stay quiet.
    if (buf.getLine(y)?.translateToString(true, x).trim()) return null;
    return { text, y, x };
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private changed() {
    this.listeners.forEach((l) => l());
  }

  /** OSC 133 payload: `A`, `B`, `C`, `D;code`, `E;command`. */
  handle(data: string): boolean {
    const [kind, ...rest] = data.split(";");
    const arg = rest.join(";");
    const last = this.blocks.at(-1);
    switch (kind) {
      case "A": {
        const prompt = this.term.registerMarker(0);
        if (!prompt) return true;
        this.prune();
        const b: Block = { id: this.next++, prompt, decorations: [] };
        this.blocks.push(b);
        this.decorate(b);
        break;
      }
      case "B":
        if (last) {
          last.input = this.term.registerMarker(0) ?? undefined;
          last.inputX = this.term.buffer.active.cursorX;
        }
        break;
      case "E":
        if (last) last.command = unescapeCommand(arg);
        break;
      case "C":
        if (last) {
          last.output = this.term.registerMarker(0) ?? undefined;
          last.startedAt = Date.now();
          this.redecorate(last);
        }
        break;
      case "D":
        if (last && last.startedAt && last.finishedAt === undefined) {
          last.end = this.term.registerMarker(0) ?? undefined;
          last.finishedAt = Date.now();
          last.exitCode = Number.parseInt(arg, 10) || 0;
          this.redecorate(last);
          this.onFinish(last);
        }
        break;
    }
    this.changed();
    return true;
  }

  private prune() {
    // The newest block survives even when its prompt scrolled out: it may still be running.
    while (
      this.blocks.length > 1 &&
      (this.blocks.length > MAX_BLOCKS || this.blocks[0].prompt.isDisposed)
    ) {
      const b = this.blocks.shift();
      b?.decorations.forEach((d) => d.dispose());
    }
  }

  private redecorate(b: Block) {
    b.decorations.forEach((d) => d.dispose());
    b.decorations = [];
    this.decorate(b);
  }

  refreshDecorations() {
    for (const b of this.blocks) this.redecorate(b);
  }

  private decorate(b: Block) {
    const { marks, separators } = this.opts();
    if (separators && this.blocks.length > 1 && b.id !== this.blocks[0].id) {
      const sep = this.term.registerDecoration({
        marker: b.prompt,
        width: this.term.cols,
        layer: "bottom",
      });
      sep?.onRender((el) => {
        el.classList.add("block-sep");
        el.style.width = "100%";
      });
      if (sep) b.decorations.push(sep);
    }
    if (!marks) return;
    const status =
      b.finishedAt === undefined ? (b.startedAt ? "running" : "idle") : b.exitCode ? "fail" : "ok";
    if (status === "idle") return;
    const mark = this.term.registerDecoration({
      marker: b.prompt,
      width: 1,
      layer: "top",
      overviewRulerOptions: status === "fail" ? { color: "#e06c75", position: "left" } : undefined,
    });
    mark?.onRender((el) => {
      el.className = `xterm-decoration prompt-mark ${status}`;
      el.title =
        status === "running"
          ? ""
          : `${b.exitCode ? `exit ${b.exitCode} · ` : ""}${fmtMs((b.finishedAt ?? 0) - (b.startedAt ?? 0))}`;
    });
    if (mark) b.decorations.push(mark);
  }

  /** Block whose prompt is the closest at or above `line`. */
  blockAt(line: number): Block | undefined {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      if (this.blocks[i].prompt.line <= line) return this.blocks[i];
    }
    return undefined;
  }

  lastFinished(): Block | undefined {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      if (this.blocks[i].finishedAt !== undefined) return this.blocks[i];
    }
    return undefined;
  }

  /** Output text of a block (between C and D). */
  outputText(b: Block): string {
    if (!b.output) return "";
    const buf = this.term.buffer.active;
    const start = b.output.line;
    const end = b.end ? b.end.line : buf.length;
    const lines: string[] = [];
    for (let y = start; y < end; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    while (lines.length && !lines.at(-1)!.trim()) lines.pop();
    return lines.join("\n");
  }

  outputRange(b: Block): [number, number] | null {
    if (!b.output) return null;
    const end = b.end ? b.end.line - 1 : this.term.buffer.active.length - 1;
    return end >= b.output.line ? [b.output.line, end] : null;
  }

  /** Prompt line before/after the viewport top. */
  promptLine(dir: -1 | 1): number | undefined {
    const top = this.term.buffer.active.viewportY;
    const lines = this.blocks.map((b) => b.prompt.line).filter((l) => l >= 0);
    if (dir < 0) return [...lines].reverse().find((l) => l < top);
    return lines.find((l) => l > top);
  }
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
}
