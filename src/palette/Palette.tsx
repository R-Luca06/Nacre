import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { actions, actionLabel } from "../app/actions";
import { focusPane, newTab } from "../app/ops";
import { useConfig } from "../store/config";
import { openWorkspace, useWorkspaces } from "../app/workspaces";
import { formatCombo } from "../keybindings/combo";
import { bindingsFor, runAction } from "../keybindings/runtime";
import { activeTab, useWorkspace } from "../store/workspace";
import { getSession } from "../terminal/registry";
import { fuzzyFilter } from "../util/fuzzy";
import { snippetParams } from "../config/snippets";
import { tildify } from "../app/paths";
import { t } from "../i18n";
import "./palette.css";

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  /** Secondary text, dimmed (e.g. a directory). */
  detail?: string;
  /** `alt` is true when chosen with ⌘↩. */
  run: (alt: boolean) => void;
}

export type PaletteMode = "commands" | "history" | "dirs" | "snippets" | "ssh";

/** Extra item sources for the command mode (profiles, workspaces, plugins…). */
const sources: (() => PaletteItem[])[] = [];
export function addPaletteSource(fn: () => PaletteItem[]) {
  sources.push(fn);
}

addPaletteSource(() =>
  Object.keys(useConfig.getState().config.profiles).map((name) => ({
    id: `profile:${name}`,
    label: `${t("New Tab")}: ${name}`,
    run: () => void newTab({ profile: name }),
  })),
);

addPaletteSource(() =>
  useWorkspaces.getState().list.map((w) => ({
    id: `workspace:${w.file}`,
    label: `${t("Workspace")}: ${w.name}`,
    run: () => openWorkspace(w),
  })),
);

function actionItems(): PaletteItem[] {
  return actions
    .filter((a) => !a.hidden)
    .map((a) => {
      const keys = bindingsFor(a.id);
      return {
        id: a.id,
        label: actionLabel(a),
        hint: keys.length ? formatCombo(keys[0]) : undefined,
        run: () => void runAction(a.id, "palette"),
      };
    });
}

const ws = () => useWorkspace.getState();

function activeShell() {
  const id = activeTab()?.active;
  const meta = id ? ws().panes[id] : undefined;
  return { id, session: id ? getSession(id) : undefined, idle: !meta?.proc || meta.proc.isShell };
}

/** Replaces the prompt line with `text`; runs it when asked. */
export function typeInActivePane(text: string, run: boolean) {
  const { session } = activeShell();
  if (!session) return;
  session.send("\x15" + text.replace(/\n/g, " ") + (run ? "\r" : ""));
}

const quote = (p: string) => (/^[\w./~-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);

async function load(mode: PaletteMode, query: string): Promise<PaletteItem[]> {
  switch (mode) {
    case "commands":
      return fuzzyFilter([...actionItems(), ...sources.flatMap((s) => s())], query, (i) => i.label);
    case "history": {
      const rows = await invoke<{ command: string; cwd: string | null; exit: number | null }[]>(
        "history_search",
        { query, limit: 200 },
      );
      return rows.map((r, i) => ({
        id: `h${i}`,
        label: r.command,
        detail: r.cwd ? tildify(r.cwd) : undefined,
        run: (alt) => typeInActivePane(r.command, alt),
      }));
    }
    case "dirs": {
      const rows = await invoke<{ path: string }[]>("dirs_top", { query, limit: 100 });
      return rows.map((r) => ({
        id: r.path,
        label: tildify(r.path),
        run: (alt) => {
          const { idle } = activeShell();
          if (alt || !idle) void newTab({ cwd: r.path });
          else typeInActivePane(`cd ${quote(r.path)}`, true);
        },
      }));
    }
    case "snippets": {
      const snippets = useConfig.getState().config.snippets;
      const items = Object.entries(snippets).map(([name, tpl]) => ({
        id: name,
        label: name,
        detail: tpl,
        run: (alt: boolean) => {
          if (snippetParams(tpl).length)
            ws().setOverlay({ kind: "snippet", name, template: tpl, run: alt });
          else typeInActivePane(tpl, alt);
        },
      }));
      return fuzzyFilter(items, query, (i) => `${i.label} ${i.detail}`);
    }
    case "ssh": {
      const hosts =
        await invoke<{ name: string; hostname: string | null; user: string | null }[]>("ssh_hosts");
      const items = hosts.map((h) => ({
        id: h.name,
        label: h.name,
        detail: [h.user, h.hostname].filter(Boolean).join("@") || undefined,
        run: (alt: boolean) => {
          if (alt) typeInActivePane(`ssh ${quote(h.name)}`, true);
          else void newTab({ command: `ssh ${quote(h.name)}` });
        },
      }));
      return fuzzyFilter(items, query, (i) => `${i.label} ${i.detail ?? ""}`);
    }
  }
}

const PLACEHOLDER: Record<PaletteMode, string> = {
  commands: "Type a command",
  history: "Search history",
  dirs: "Go to directory",
  snippets: "Snippets",
  ssh: "SSH hosts",
};

const EMPTY: Record<PaletteMode, string> = {
  commands: "No results",
  history: "No history yet",
  dirs: "No directories yet",
  snippets: "Add snippets in config.toml under [snippets]",
  ssh: "No hosts in ~/.ssh/config",
};

export function Palette({ mode = "commands" }: { mode?: PaletteMode }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [items, setItems] = useState<PaletteItem[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const commands = useMemo(() => (mode === "commands" ? load("commands", "") : null), [mode]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(
      () => {
        const p =
          mode === "commands" && commands
            ? commands.then((all) => fuzzyFilter(all, query, (i) => i.label))
            : load(mode, query);
        void p.then(
          (r) => alive && setItems(r),
          () => alive && setItems([]),
        );
      },
      mode === "history" || mode === "dirs" ? 60 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [mode, query, commands]);
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const close = () => {
    ws().setOverlay(null);
    const tab = activeTab();
    if (tab) focusPane(tab.active);
  };
  const choose = (item: PaletteItem | undefined, alt: boolean) => {
    if (!item) return;
    close();
    item.run(alt);
  };

  return (
    <div className="scrim" onMouseDown={close}>
      <div className="palette popover" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={query}
          spellCheck={false}
          placeholder={t(PLACEHOLDER[mode])}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
              e.preventDefault();
              setIndex((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(items[index], e.metaKey);
            }
          }}
        />
        <div className="palette-list" ref={list}>
          {items.map((item, i) => (
            <div
              key={item.id}
              className={`palette-row${i === index ? " selected" : ""}`}
              onMouseMove={() => setIndex(i)}
              onClick={(e) => choose(item, e.metaKey)}
            >
              <span className={mode === "history" || mode === "snippets" ? "mono" : ""}>
                {item.label}
              </span>
              {item.detail && <span className="palette-detail">{item.detail}</span>}
              {item.hint && <span className="kbd">{item.hint}</span>}
            </div>
          ))}
          {items.length === 0 && <div className="palette-empty">{t(EMPTY[mode])}</div>}
        </div>
      </div>
    </div>
  );
}
