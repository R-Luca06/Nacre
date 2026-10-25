import { useEffect, useRef, useState } from "react";
import { Pin, Plus, X } from "lucide-react";
import { Menu } from "@tauri-apps/api/menu";
import { type Tab, useWorkspace } from "../store/workspace";
import { paneIds } from "../layout/tree";
import { t } from "../i18n";
import { ProcessIcon } from "./ProcessIcon";
import { tabTitle } from "./titles";
import * as ops from "./ops";
import "./tabbar.css";

export const TAB_COLORS = ["#E06C75", "#E5C07B", "#98C379", "#7FCFC4", "#7AA2D6", "#C49BD8"];

export function TabBar({ fullscreen }: { fullscreen: boolean }) {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; dx: number } | null>(null);

  const startDrag = (e: React.PointerEvent, tab: Tab) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return;
      moved = true;
      setDrag({ id: tab.id, x: ev.clientX, dx });
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
        return ev.clientX < r.left + r.width / 2;
      });
      if (index < 0) index = others.length;
      ops.reorderTab(tab.id, index);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className={`tabbar${fullscreen ? " fullscreen" : ""}`} data-tauri-drag-region>
      <div className="tabs" ref={listRef} data-tauri-drag-region>
        {tabs.map((tab, i) => (
          <TabItem
            key={tab.id}
            tab={tab}
            index={i}
            active={tab.id === activeTabId}
            dragDx={drag?.id === tab.id ? drag.dx : 0}
            onPointerDown={(e) => startDrag(e, tab)}
          />
        ))}
        <button className="tab-new icon-btn" title={t("New Tab")} onClick={() => ops.newTab()}>
          <Plus size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

function TabItem(props: {
  tab: Tab;
  index: number;
  active: boolean;
  dragDx: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const { tab, active, dragDx } = props;
  const panes = useWorkspace((s) => s.panes);
  const renaming = useWorkspace((s) => s.overlay?.kind === "rename" && s.overlay.tabId === tab.id);
  const ids = paneIds(tab.root);
  const meta = panes[tab.active];
  const title = tabTitle(tab, panes);
  const bell = ids.some((p) => panes[p]?.bell);
  const activity = !bell && ids.some((p) => panes[p]?.activity);

  const showMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const menu = await Menu.new({
      items: [
        { text: t("Rename"), action: () => ops.selectTabThen(tab.id, "rename") },
        { text: tab.pinned ? t("Unpin Tab") : t("Pin Tab"), action: () => ops.togglePin(tab.id) },
        { text: t("Duplicate Tab"), action: () => ops.selectTabThen(tab.id, "duplicate") },
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
      style={dragDx ? { transform: `translateX(${dragDx}px)` } : undefined}
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
      <ProcessIcon proc={meta?.proc} />
      {renaming ? (
        <RenameField tab={tab} initial={title} />
      ) : (
        !tab.pinned && <span className="tab-title">{title}</span>
      )}
      {tab.pinned && !renaming && <Pin size={10} strokeWidth={1.5} className="tab-pin" />}
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
    ref.current?.focus();
    ref.current?.select();
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
