import { useEffect, useRef } from "react";
import type { TerminalSession } from "./session";

const DURATION = 120;

/** Neovide-style smear: a short fading streak when the cursor jumps. */
export function CursorTrail({ session }: { session: TerminalSession }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const term = session.term;
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let prev: { x: number; y: number } | null = null;
    let frame = 0;
    const cellPos = () => {
      const screen = term.element?.querySelector(".xterm-screen") as HTMLElement | null;
      const pane = session.host.parentElement;
      if (!screen || !pane) return null;
      const r = screen.getBoundingClientRect();
      const p = pane.getBoundingClientRect();
      const cw = r.width / term.cols;
      const ch = r.height / term.rows;
      const buf = term.buffer.active;
      const row = buf.baseY + buf.cursorY - buf.viewportY;
      return {
        x: r.left - p.left + buf.cursorX * cw + cw / 2,
        y: r.top - p.top + row * ch + ch / 2,
        ch,
      };
    };
    const onMove = () => {
      const now = cellPos();
      if (!now) return;
      const from = prev;
      prev = { x: now.x, y: now.y };
      if (!from || (Math.abs(from.x - now.x) < 2 && Math.abs(from.y - now.y) < 2)) return;
      const color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      const start = performance.now();
      cancelAnimationFrame(frame);
      const draw = (t: number) => {
        const k = Math.min(1, (t - start) / DURATION);
        const pane = session.host.parentElement!;
        const dpr = window.devicePixelRatio || 1;
        c.width = pane.clientWidth * dpr;
        c.height = pane.clientHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, pane.clientWidth, pane.clientHeight);
        if (k >= 1) return;
        // The tail catches up with the head.
        const tx = from.x + (now.x - from.x) * k;
        const ty = from.y + (now.y - from.y) * k;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5 * (1 - k);
        ctx.lineCap = "round";
        ctx.lineWidth = now.ch * 0.6;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(now.x, now.y);
        ctx.stroke();
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
    };
    const d = term.onCursorMove(onMove);
    return () => {
      d.dispose();
      cancelAnimationFrame(frame);
    };
  }, [session]);
  return <canvas ref={canvas} className="cursor-trail" />;
}
