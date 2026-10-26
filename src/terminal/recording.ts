/** asciicast v2: a JSON header line, then `[seconds, "o", data]` lines. */
export interface Cast {
  width: number;
  height: number;
  events: [number, string][];
}

export class Recorder {
  private start = performance.now();
  private decoder = new TextDecoder();
  readonly events: [number, string][] = [];

  push(bytes: Uint8Array) {
    const text = this.decoder.decode(bytes, { stream: true });
    if (text) this.events.push([(performance.now() - this.start) / 1000, text]);
  }

  toCast(width: number, height: number, shell: string): string {
    const header = {
      version: 2,
      width,
      height,
      timestamp: Math.floor(Date.now() / 1000 - (performance.now() - this.start) / 1000),
      env: { TERM: "xterm-256color", SHELL: shell },
    };
    const lines = [JSON.stringify(header)];
    for (const [t, d] of this.events) lines.push(JSON.stringify([Number(t.toFixed(6)), "o", d]));
    return lines.join("\n") + "\n";
  }
}

export function parseCast(text: string): Cast {
  const lines = text.split("\n").filter((l) => l.trim());
  const header = JSON.parse(lines[0] ?? "{}");
  if (header.version !== 2) throw new Error("Not an asciicast v2 file.");
  const events: [number, string][] = [];
  for (const l of lines.slice(1)) {
    const e = JSON.parse(l);
    if (Array.isArray(e) && e[1] === "o") events.push([Number(e[0]), String(e[2])]);
  }
  return { width: header.width ?? 80, height: header.height ?? 24, events };
}

/** Replays with pauses capped at `maxIdle` seconds; returns a stop function. */
export function play(
  cast: Cast,
  write: (data: string) => void,
  onEnd: () => void,
  maxIdle = 2,
): () => void {
  let i = 0;
  let timer = 0;
  const step = () => {
    if (i >= cast.events.length) return onEnd();
    const [t, data] = cast.events[i++];
    write(data);
    const next = cast.events[i]?.[0];
    if (next === undefined) return onEnd();
    const wait = Math.min(maxIdle, Math.max(0, next - t)) * 1000;
    timer = window.setTimeout(step, wait);
  };
  timer = window.setTimeout(step, 0);
  return () => clearTimeout(timer);
}
