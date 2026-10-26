import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConfig } from "../store/config";
import { useWorkspace } from "../store/workspace";
import type { TerminalSession } from "./session";
import { complete } from "./specs";
import "./suggest.css";

interface Item {
  label: string;
  /** Text typed when accepted. */
  insert: string;
}

interface Menu {
  items: Item[];
  index: number;
}

/** Opens the completion menu in a pane. */
export const requestCompletion = (paneId: string) =>
  window.dispatchEvent(new CustomEvent("nacre-complete", { detail: paneId }));

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

async function candidates(input: string, cwd: string | null): Promise<Item[]> {
  const words = input.split(/\s+/);
  const word = words.at(-1) ?? "";
  const runner = ["npm", "pnpm", "yarn", "bun"].includes(words[0]) && words[1] === "run";
  const [history, scripts] = await Promise.all([
    invoke<string[]>("history_prefix", { prefix: input, cwd, limit: 8 }),
    runner && cwd ? invoke<string[]>("package_scripts", { cwd }) : Promise.resolve([]),
  ]);
  const items: Item[] = complete(input, scripts).map((w) => ({
    label: w,
    insert: w.slice(word.length) + " ",
  }));
  for (const h of history) {
    if (!h.includes("\n")) items.push({ label: h, insert: h.slice(input.length) });
  }
  return items.slice(0, 10);
}

/** History autosuggestion and the completion menu, over the active pane. */
export function Suggest({ session, paneId }: { session: TerminalSession; paneId: string }) {
  const enabled = useConfig((s) => s.config.terminal.autosuggest);
  const [ghost, setGhost] = useState<{ text: string; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [viewport, setViewport] = useState(session.term.buffer.active.viewportY);
  const live = useRef({ ghost, menu });
  useEffect(() => {
    live.current = { ghost, menu };
  });

  useEffect(() => {
    let timer = 0;
    let seq = 0;
    const update = () => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const input = session.commands.currentInput();
        const my = ++seq;
        if (!input || !input.text.trim()) {
          setGhost(null);
          setMenu(null);
          return;
        }
        const cwd = useWorkspace.getState().panes[paneId]?.cwd ?? null;
        if (live.current.menu) {
          const items = await candidates(input.text, cwd);
          if (my !== seq) return;
          setMenu(items.length ? { items, index: 0 } : null);
          setGhost(null);
          return;
        }
        if (!enabled) return setGhost(null);
        const [top] = await invoke<string[]>("history_prefix", {
          prefix: input.text,
          cwd,
          limit: 1,
        });
        if (my !== seq) return;
        const rest = top?.slice(input.text.length).split("\n")[0];
        setGhost(rest ? { text: rest, x: input.x, y: input.y } : null);
      }, 30);
    };
    const open = async (e: Event) => {
      if ((e as CustomEvent<string>).detail !== paneId) return;
      const input = session.commands.currentInput();
      if (!input) return;
      const items = await candidates(
        input.text,
        useWorkspace.getState().panes[paneId]?.cwd ?? null,
      );
      setGhost(null);
      setMenu(items.length ? { items, index: 0 } : null);
    };
    const subs = [
      session.term.onCursorMove(update),
      session.term.onWriteParsed(update),
      session.term.onScroll(setViewport),
    ];
    window.addEventListener("nacre-complete", open);
    session.setKeyHook((e) => {
      const { ghost, menu } = live.current;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (menu) {
        const n = menu.items.length;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const d = e.key === "ArrowDown" ? 1 : -1;
          const next = { ...menu, index: (menu.index + d + n) % n };
          live.current.menu = next;
          setMenu(next);
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          session.send(menu.items[menu.index].insert);
          setMenu(null);
          return true;
        }
        if (e.key === "Escape") {
          setMenu(null);
          return true;
        }
        return false;
      }
      if (ghost && plain && !e.shiftKey && e.key === "ArrowRight") {
        session.send(ghost.text);
        setGhost(null);
        return true;
      }
      return false;
    });
    return () => {
      clearTimeout(timer);
      subs.forEach((d) => d.dispose());
      window.removeEventListener("nacre-complete", open);
      session.setKeyHook(null);
    };
  }, [session, paneId, enabled]);

  const geo = geometry(session);
  const input = menu ? session.commands.currentInput() : null;
  if (!geo) return null;
  const font = {
    fontFamily: session.term.options.fontFamily,
    fontSize: session.term.options.fontSize,
    lineHeight: `${geo.ch}px`,
  };
  return (
    <>
      {ghost && ghost.y - viewport >= 0 && ghost.y - viewport < session.term.rows && (
        <span
          className="ghost"
          style={{
            ...font,
            left: geo.left + ghost.x * geo.cw,
            top: geo.top + (ghost.y - viewport) * geo.ch,
          }}
        >
          {ghost.text}
        </span>
      )}
      {menu && input && (
        <ul
          className="complete-menu popover"
          style={{
            ...font,
            left: geo.left + Math.max(0, input.x - 2) * geo.cw,
            ...(input.y - viewport > session.term.rows / 2
              ? { bottom: `calc(100% - ${geo.top + (input.y - viewport) * geo.ch}px)` }
              : { top: geo.top + (input.y - viewport + 1) * geo.ch }),
          }}
        >
          {menu.items.map((item, i) => (
            <li
              key={item.label}
              className={i === menu.index ? "selected" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                session.send(item.insert);
                setMenu(null);
                session.focus();
              }}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
