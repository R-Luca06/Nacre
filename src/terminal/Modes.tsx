import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { copyText as writeText } from "../app/clipboard";
import { t } from "../i18n";
import { useConfig } from "../store/config";
import { useWorkspace } from "../store/workspace";
import { focusPane } from "../app/ops";
import type { TerminalSession } from "./session";
import { type Hint, findHints } from "./hints";

export type PaneMode = { kind: "hints" | "copy"; paneId: string };

/** Cell size and screen offset inside the pane element. */
function geometry(s: TerminalSession) {
  const screen = s.term.element?.querySelector(".xterm-screen") as HTMLElement | null;
  const pane = s.host.parentElement;
  if (!screen || !pane) return null;
  const r = screen.getBoundingClientRect();
  const p = pane.getBoundingClientRect();
  return {
    left: r.left - p.left,
    top: r.top - p.top,
    cw: r.width / s.term.cols,
    ch: r.height / s.term.rows,
  };
}

const exit = (paneId: string) => {
  useWorkspace.getState().setMode(null);
  focusPane(paneId);
};

function visibleLines(s: TerminalSession): string[] {
  const buf = s.term.buffer.active;
  const out: string[] = [];
  for (let i = 0; i < s.term.rows; i++)
    out.push(buf.getLine(buf.viewportY + i)?.translateToString(false) ?? "");
  return out;
}

/** Kitty-style hints: type a label to copy, Shift+label to open. */
export function HintsOverlay({ session }: { session: TerminalSession }) {
  const hints = useMemo(() => findHints(visibleLines(session)), [session]);
  const geo = useMemo(() => geometry(session), [session]);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const act = (h: Hint, open: boolean) => {
      exit(session.id);
      if (!open || h.kind === "hash" || h.kind === "ip") {
        void writeText(h.text);
        useWorkspace.getState().showToast(t("Copied"));
      } else if (h.kind === "url") {
        void openUrl(h.text);
      } else if (h.kind === "email") {
        void openUrl(`mailto:${h.text}`);
      } else {
        const [file, line, col] = h.text.split(":");
        void invoke<(string | null)[]>("paths_exist", {
          cwd: useWorkspace.getState().panes[session.id]?.cwd ?? null,
          paths: [file],
        }).then(([abs]) => {
          if (abs)
            void invoke("open_in_editor", {
              template: useConfig.getState().config.general.editor,
              file: abs,
              line: line ? Number(line) : null,
              col: col ? Number(col) : null,
            });
        });
      }
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return exit(session.id);
      if (e.key === "Backspace") return setTyped((x) => x.slice(0, -1));
      if (!/^[a-z]$/i.test(e.key)) return;
      const next = typed + e.key.toLowerCase();
      const exact = hints.find((h) => h.label === next);
      if (exact) act(exact, e.shiftKey);
      else if (hints.some((h) => h.label.startsWith(next))) setTyped(next);
      else exit(session.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [session, hints, typed]);

  useEffect(() => {
    if (!hints.length) {
      useWorkspace.getState().showToast(t("Nothing to pick on screen"));
      exit(session.id);
    }
  }, [hints, session]);

  if (!geo) return null;
  return (
    <div className="mode-layer">
      {hints
        .filter((h) => h.label.startsWith(typed))
        .map((h) => (
          <span
            key={`${h.row}:${h.col}`}
            className="hint"
            style={{
              left: geo.left + h.col * geo.cw,
              top: geo.top + h.row * geo.ch,
              height: geo.ch,
            }}
          >
            <b>{typed}</b>
            {h.label.slice(typed.length)}
          </span>
        ))}
    </div>
  );
}

const isWord = (c: string) => /[\w\-./~@]/.test(c);

/** Vim-like keyboard navigation and selection over the scrollback. */
export function CopyMode({ session }: { session: TerminalSession }) {
  const term = session.term;
  const buf = term.buffer.active;
  const [cur, setCur] = useState({ x: buf.cursorX, y: buf.baseY + buf.cursorY });
  const [anchor, setAnchor] = useState<{ x: number; y: number; line: boolean } | null>(null);
  const [viewport, setViewport] = useState(buf.viewportY);
  const geo = geometry(session);

  useEffect(() => {
    const d = term.onScroll((y) => setViewport(y));
    return () => d.dispose();
  }, [term]);

  useEffect(() => {
    const lineText = (y: number) => buf.getLine(y)?.translateToString(false) ?? "";
    const last = buf.length - 1;
    const clamp = (p: { x: number; y: number }) => {
      const y = Math.max(0, Math.min(last, p.y));
      return { y, x: Math.max(0, Math.min(term.cols - 1, p.x)) };
    };
    const show = (p: { x: number; y: number }) => {
      const top = buf.viewportY;
      if (p.y < top) term.scrollToLine(p.y);
      else if (p.y >= top + term.rows) term.scrollToLine(p.y - term.rows + 1);
    };
    const select = (p: { x: number; y: number }, a: typeof anchor) => {
      if (!a) return term.clearSelection();
      if (a.line) return term.selectLines(Math.min(a.y, p.y), Math.max(a.y, p.y));
      const [s, e] = a.y < p.y || (a.y === p.y && a.x <= p.x) ? [a, p] : [p, a];
      term.select(s.x, s.y, (e.y - s.y) * term.cols + (e.x - s.x) + 1);
    };
    const onKey = (ev: KeyboardEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      let p = { ...cur };
      const half = Math.floor(term.rows / 2);
      const text = lineText(p.y);
      switch (ev.ctrlKey ? `C-${ev.key}` : ev.key) {
        case "Escape":
        case "q":
          term.clearSelection();
          return exit(session.id);
        case "h":
        case "ArrowLeft":
          p.x--;
          break;
        case "l":
        case "ArrowRight":
          p.x++;
          break;
        case "k":
        case "ArrowUp":
          p.y--;
          break;
        case "j":
        case "ArrowDown":
          p.y++;
          break;
        case "0":
          p.x = 0;
          break;
        case "^":
          p.x = Math.max(0, text.search(/\S/));
          break;
        case "$":
          p.x = Math.max(0, text.trimEnd().length - 1);
          break;
        case "w": {
          let x = p.x;
          while (x < text.length && isWord(text[x])) x++;
          while (x < text.length && !isWord(text[x])) x++;
          p.x = x;
          break;
        }
        case "b": {
          let x = p.x - 1;
          while (x > 0 && !isWord(text[x])) x--;
          while (x > 0 && isWord(text[x - 1])) x--;
          p.x = Math.max(0, x);
          break;
        }
        case "g":
          p = { x: 0, y: 0 };
          break;
        case "G":
          p = { x: 0, y: last };
          break;
        case "C-u":
          p.y -= half;
          break;
        case "C-d":
          p.y += half;
          break;
        case "C-b":
          p.y -= term.rows;
          break;
        case "C-f":
          p.y += term.rows;
          break;
        case "v":
          setAnchor(anchor && !anchor.line ? null : { ...p, line: false });
          select(p, anchor && !anchor.line ? null : { ...p, line: false });
          return;
        case "V":
          setAnchor(anchor?.line ? null : { ...p, line: true });
          select(p, anchor?.line ? null : { ...p, line: true });
          return;
        case "y":
        case "Enter": {
          const sel = term.getSelection() || lineText(p.y).trimEnd();
          void writeText(sel);
          useWorkspace.getState().showToast(t("Copied"));
          term.clearSelection();
          return exit(session.id);
        }
        default:
          return;
      }
      p = clamp(p);
      setCur(p);
      show(p);
      select(p, anchor);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cur, anchor, buf, term, session]);

  if (!geo) return null;
  const row = cur.y - viewport;
  return (
    <div className="mode-layer">
      <span className="mode-badge">
        {anchor ? (anchor.line ? "V-LINE" : "VISUAL") : t("Copy mode")}
      </span>
      {row >= 0 && row < term.rows && (
        <span
          className="copy-cursor"
          style={{
            left: geo.left + cur.x * geo.cw,
            top: geo.top + row * geo.ch,
            width: geo.cw,
            height: geo.ch,
          }}
        />
      )}
    </div>
  );
}
