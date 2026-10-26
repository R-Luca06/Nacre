import { useEffect, useState } from "react";
import type { Block } from "./blocks";
import { fmtMs } from "./blocks";
import type { TerminalSession } from "./session";

/** Keeps the running/viewed command visible while scrolling through its output. */
export function StickyHeader({ session }: { session: TerminalSession }) {
  const [block, setBlock] = useState<Block | null>(null);

  useEffect(() => {
    const update = () => {
      const buf = session.term.buffer.active;
      const top = buf.viewportY;
      const b = session.commands.blockAt(top);
      // Only while browsing back through output whose prompt is out of view.
      const show =
        top < buf.baseY && b && b.output && b.prompt.line < top && (!b.end || b.end.line > top);
      setBlock(show ? b : null);
    };
    const a = session.term.onScroll(update);
    const c = session.commands.onChange(update);
    const w = session.term.onWriteParsed(update);
    update();
    return () => {
      a.dispose();
      c();
      w.dispose();
    };
  }, [session]);

  if (!block?.command) return null;
  const status = block.finishedAt === undefined ? "running" : block.exitCode ? "fail" : "ok";
  return (
    <button
      className={`sticky-head ${status}`}
      onClick={() => session.term.scrollToLine(block.prompt.line)}
    >
      <span className="cmd">$ {block.command.split("\n")[0]}</span>
      {block.finishedAt !== undefined && (
        <span className="meta">
          {block.exitCode ? `exit ${block.exitCode} · ` : ""}
          {fmtMs(block.finishedAt - (block.startedAt ?? block.finishedAt))}
        </span>
      )}
    </button>
  );
}
