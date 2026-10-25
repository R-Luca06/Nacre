import { useEffect, useRef } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { TerminalSession, type TerminalSettings } from "../terminal/session";
import { Keymap } from "../keybindings/keymap";
import "./app.css";

const settings: TerminalSettings = {
  fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
  fontSize: 13,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 10000,
  optionAsMeta: "left",
  copyOnSelect: false,
  padding: 8,
  theme: { background: "#101114", foreground: "#d8d9dc" },
};

const keymap = new Keymap({
  copy: ["cmd+c"],
  paste: ["cmd+v"],
  selectAll: ["cmd+a"],
});

export function App() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = new TerminalSession(
      "main-1",
      settings,
      {},
      {
        onKey: (e, session) => {
          const r = keymap.handle(e);
          if (r.kind !== "action") return r.kind !== "none";
          if (r.action === "copy") {
            if (!session.hasSelection()) return false;
            void writeText(session.getSelection());
          } else if (r.action === "paste") {
            void readText().then((t) => t && session.paste(t));
          } else if (r.action === "selectAll") {
            session.term.selectAll();
          }
          return true;
        },
      },
    );
    s.mount(ref.current!);
    s.focus();
    const ro = new ResizeObserver(() => s.fit());
    ro.observe(ref.current!);
    return () => {
      ro.disconnect();
      s.dispose();
    };
  }, []);

  return <div ref={ref} className="pane" />;
}
