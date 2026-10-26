import { useEffect, useRef, useState } from "react";
import { Pin, Plus, Settings, X } from "lucide-react";
import { Menu } from "@tauri-apps/api/menu";
import { moveTab } from "./moveTab";
import { type Tab, useWorkspace } from "../store/workspace";
import { paneIds } from "../layout/tree";
import { t } from "../i18n";
import { ProcessIcon } from "./ProcessIcon";
import { useClaude } from "../claude/store";
import { allThemes, useConfig } from "../store/config";
import { tabTitle } from "./titles";
import * as ops from "./ops";
import { closeSettings } from "../settings/Settings";
import "./tabbar.css";

export const TAB_COLORS = ["#E06C75", "#E5C07B", "#98C379", "#7FCFC4", "#7AA2D6", "#C49BD8"];

export function TabBar({ fullscreen, vertical }: { fullscreen: boolean; vertical?: boolean }) {
  const width = useConfig((s) => s.config.window.sidebar_width);
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const settingsOpen = useWorkspace((s) => s.overlay?.kind === "settings");
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);
  const pos = (ev: { clientX: number; clientY: number }) => (vertical ? ev.clientY : ev.clientX);

  const startDrag = (e: React.PointerEvent, tab: Tab) => {
    if (e.button !== 0) return;
    const start = pos(e);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = pos(ev) - start;
      if (!moved && Math.abs(dx) < 4) return;
      moved = true;
      setDrag({ id: tab.id, dx });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!moved || !listRef.current) return;
      const items = [...listRef.current.querySelectorAll<HTMLElement>("[data-tab]")];
      const others = items.filter((el) => el.dataset.tab !== tab.id);
      let index = others.findIndex((el) => {
        const r = el.getBoundingClientRect();
        return vertical ? ev.clientY < r.top + r.height / 2 : ev.clientX < r.left + r.width / 2;
      });
      if (index < 0) index = others.length;
      ops.reorderTab(tab.id, index);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={`tabbar${fullscreen ? " fullscreen" : ""}${vertical ? " vertical" : ""}`}
      style={vertical ? { width } : undefined}
      data-tauri-drag-region
    >
      <div className="tabs" ref={listRef} data-tauri-drag-region>
        {tabs.map((tab, i) => (
          <TabItem
            key={tab.id}
            tab={tab}
            index={i}
            active={tab.id === activeTabId}
            dragDx={drag?.id === tab.id ? drag.dx : 0}
            vertical={vertical}
            onPointerDown={(e) => startDrag(e, tab)}
          />
        ))}
        <button
          className="tab-new icon-btn"
          title={t("New Tab")}
          onClick={() => ops.newTab()}
          onContextMenu={(e) => {
            e.preventDefault();
            void showProfileMenu();
          }}
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>
      </div>
      <button
        className={`tab-settings icon-btn${settingsOpen ? " on" : ""}`}
        title={t("Settings")}
        onClick={() => (settingsOpen ? closeSettings() : ops.openSettings())}
      >
        <Settings size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

async function showProfileMenu() {
  const names = Object.keys(useConfig.getState().config.profiles);
  const menu = await Menu.new({
    items: [
      { text: t("Default"), action: () => void ops.newTab() },
      ...(names.length ? [{ item: "Separator" as const }] : []),
      ...names.map((n) => ({ text: n, action: () => void ops.newTab({ profile: n }) })),
    ],
  });
  await menu.popup();
}

function TabItem(props: {
  tab: Tab;
  index: number;
  active: boolean;
  dragDx: number;
  vertical?: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const { tab, active, dragDx, vertical } = props;
  const panes = useWorkspace((s) => s.panes);
  const renaming = useWorkspace((s) => s.overlay?.kind === "rename" && s.overlay.tabId === tab.id);
  const ids = paneIds(tab.root);
  const meta = panes[tab.active];
  const title = tabTitle(tab, panes);
  const sessions = useClaude((s) => s.sessions);
  const claude = sessions.filter((c) => c.paneId && ids.includes(c.paneId) && c.state !== "ended");
  const waiting = claude.some((c) => c.attention);
  const working = claude.some(
    (c) => c.state === "thinking" || c.state === "tool" || c.state === "compacting",
  );
  const bell = ids.some((p) => panes[p]?.bell);
  const activity = !bell && !waiting && ids.some((p) => panes[p]?.activity);

  const showMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const menu = await Menu.new({
      items: [
        { text: t("Rename"), action: () => ops.selectTabThen(tab.id, "rename") },
        { text: tab.pinned ? t("Unpin Tab") : t("Pin Tab"), action: () => ops.togglePin(tab.id) },
        { text: t("Duplicate Tab"), action: () => ops.selectTabThen(tab.id, "duplicate") },
        {
          text: t("Move Tab to New Window"),
          action: () => {
            ops.selectTab(tab.id);
            void moveTab("new");
          },
        },
        {
          text: t("Tab Color"),
          items: [
            ...TAB_COLORS.map((c, i) => ({
              text: t(["Red", "Yellow", "Green", "Cyan", "Blue", "Purple"][i]),
              action: () => ops.setTabColor(tab.id, c),
            })),
            { item: "Separator" as const },
            { text: t("None"), action: () => ops.setTabColor(tab.id, undefined) },
          ],
        },
        {
          text: t("Theme"),
          items: [
            { text: t("Default"), action: () => ops.setTabTheme(tab.id, undefined) },
            { item: "Separator" as const },
            ...allThemes().map((th) => ({
              text: th.name,
              checked: tab.theme === th.name,
              action: () => ops.setTabTheme(tab.id, th.name),
            })),
          ],
        },
        { item: "Separator" },
        { text: t("Close Tab"), action: () => void ops.closeTab(tab.id) },
      ],
    });
    await menu.popup();
  };

  return (
    <div
      data-tab={tab.id}
      className={`tab${active ? " active" : ""}${tab.pinned ? " pinned" : ""}${dragDx ? " dragging" : ""}`}
      style={dragDx ? { transform: `translate${vertical ? "Y" : "X"}(${dragDx}px)` } : undefined}
      onPointerDown={props.onPointerDown}
      onClick={() => ops.selectTab(tab.id)}
      onDoubleClick={() => useWorkspace.getState().setOverlay({ kind: "rename", tabId: tab.id })}
      onAuxClick={(e) => {
        if (e.button === 1) void ops.closeTab(tab.id);
      }}
      onContextMenu={showMenu}
      title={tab.pinned ? title : undefined}
    >
      {tab.color && <span className="tab-color" style={{ background: tab.color }} />}
      <ProcessIcon proc={meta?.proc} className={working ? "working" : undefined} />
      {renaming ? (
        <RenameField tab={tab} initial={title} />
      ) : (
        !tab.pinned && <span className="tab-title">{title}</span>
      )}
      {tab.pinned && !renaming && <Pin size={10} strokeWidth={1.5} className="tab-pin" />}
      {waiting && <span className="tab-dot claude" title={t("Claude is waiting")} />}
      {(bell || activity) && <span className={`tab-dot${bell ? " bell" : ""}`} />}
      {!tab.pinned && (
        <button
          className="tab-close icon-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void ops.closeTab(tab.id);
          }}
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

function RenameField({ tab, initial }: { tab: Tab; initial: string }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Selecting the tab focuses its terminal on the next frame; take focus after that,
    // or the blur closes the field right away.
    const frame = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const done = (commit: boolean) => {
    if (commit) ops.renameTab(tab.id, value === initial && !tab.title ? "" : value);
    useWorkspace.getState().setOverlay(null);
    ops.focusPane(tab.active);
  };
  return (
    <input
      ref={ref}
      className="tab-rename"
      value={value}
      size={Math.max(4, value.length)}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") done(true);
        if (e.key === "Escape") done(false);
        e.stopPropagation();
      }}
    />
  );
}
