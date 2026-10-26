import type { IBufferRange, ILink, Terminal } from "@xterm/xterm";

/** `src/main.rs:42:7`, `./a/b.ts`, `~/x/y.md` — files with an extension, optional line/col. */
const PATH_RE =
  /(?<![\w/.~@-])((?:~\/|\.{1,2}\/|\/)?(?:[\w.@+-]+\/)*[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,10})(?::(\d+))?(?::(\d+))?/g;

export interface PathMatch {
  text: string;
  path: string;
  line?: number;
  col?: number;
  start: number;
  end: number;
}

export function findPaths(line: string): PathMatch[] {
  const out: PathMatch[] = [];
  for (const m of line.matchAll(PATH_RE)) {
    const path = m[1];
    // Skip URLs and version-like tokens such as 1.2.3.
    if (/^\d+(\.\d+)+$/.test(path)) continue;
    const before = line.slice(Math.max(0, m.index! - 3), m.index);
    if (before.endsWith("://")) continue;
    out.push({
      text: m[0],
      path,
      line: m[2] ? Number(m[2]) : undefined,
      col: m[3] ? Number(m[3]) : undefined,
      start: m.index!,
      end: m.index! + m[0].length,
    });
  }
  return out;
}

/** Cmd+click on an existing file path opens it in the editor. */
export function fileLinkProvider(
  term: Terminal,
  cwd: () => string | undefined,
  resolve: (cwd: string | undefined, paths: string[]) => Promise<(string | null)[]>,
  open: (file: string, line?: number, col?: number) => void,
) {
  return {
    provideLinks(y: number, callback: (links: ILink[] | undefined) => void) {
      const line = term.buffer.active.getLine(y - 1);
      if (!line) return callback(undefined);
      const text = line.translateToString(true);
      const matches = findPaths(text);
      if (!matches.length) return callback(undefined);
      void resolve(
        cwd(),
        matches.map((m) => m.path),
      ).then(
        (abs) => {
          const links: ILink[] = [];
          matches.forEach((m, i) => {
            const file = abs[i];
            if (!file) return;
            const range: IBufferRange = { start: { x: m.start + 1, y }, end: { x: m.end, y } };
            links.push({
              range,
              text: m.text,
              decorations: { pointerCursor: true, underline: true },
              activate: (e) => {
                if (e.metaKey) open(file, m.line, m.col);
              },
            });
          });
          callback(links.length ? links : undefined);
        },
        () => callback(undefined),
      );
    },
  };
}
