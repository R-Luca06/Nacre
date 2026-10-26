import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Divider, type Rect, dividers, paneIds, rects, setBoundary } from "./tree";
import { type Tab, useWorkspace } from "../store/workspace";
import { useConfig } from "../store/config";
import { getSession } from "../terminal/registry";
import { focusPane } from "../app/ops";
import { SearchBar } from "../terminal/SearchBar";
import { t } from "../i18n";
import { StatusBar } from "../statusbar/StatusBar";
import { StickyHeader } from "../terminal/StickyHeader";
import { AiBar } from "../ai/CommandBar";
import { CopyMode, HintsOverlay } from "../terminal/Modes";
import { CursorTrail } from "../terminal/CursorTrail";
import { Suggest } from "../terminal/Suggest";
import { showContextMenu } from "../terminal/blockActions";

const pct = (n: number) => `${n * 100}%`;

function paneStyle(r: Rect): React.CSSProperties {
  // 1px gaps reveal the container's line color as separators.
  const gapL = r.x > 0 ? 1 : 0;
  const gapT = r.y > 0 ? 1 : 0;
  return {
    left: `calc(${pct(r.x)} + ${gapL}px)`,
    top: `calc(${pct(r.y)} + ${gapT}px)`,
    width: `calc(${pct(r.w)} - ${gapL}px)`,
    height: `calc(${pct(r.h)} - ${gapT}px)`,
  };
}

export function TabView({ tab, visible }: { tab: Tab; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => paneIds(tab.root), [tab.root]);
  const layout = useMemo(() => rects(tab.root), [tab.root]);
  const divs = useMemo(() => (tab.zoomed ? [] : dividers(tab.root)), [tab.root, tab.zoomed]);
  const multi = ids.length > 1 && !tab.zoomed;

  return (
    <div ref={ref} className="tabview" style={{ display: visible ? undefined : "none" }}>
      {ids.map((id) => {
        const hidden = tab.zoomed !== null && tab.zoomed !== id;
        const r = tab.zoomed === id ? { x: 0, y: 0, w: 1, h: 1 } : layout.get(id)!;
        return (
          <PaneView
            key={id}
            id={id}
            rect={r}
            visible={visible && !hidden}
            active={tab.active === id}
            showActive={multi}
          />
        );
      })}
      {divs.map((d) => (
        <DividerHandle key={`${d.splitId}:${d.index}`} d={d} tab={tab} container={ref} />
      ))}
      {tab.broadcast && <div className="broadcast-badge">{t("Broadcast Input")}</div>}
    </div>
  );
}

function PaneView(props: {
  id: string;
  rect: Rect;
  visible: boolean;
  active: boolean;
  showActive: boolean;
}) {
  const { id, rect, visible, active, showActive } = props;
  const ref = useRef<HTMLDivElement>(null);
  const searchOpen = useWorkspace((s) => s.search === id);
  const session = getSession(id);
  const ai = useWorkspace((s) => (s.ai?.paneId === id ? s.ai : null));
  const mode = useWorkspace((s) => (s.mode?.paneId === id ? s.mode.kind : null));
  const trail = useConfig((s) => s.config.cursor.trail);
  const recording = useWorkspace((s) => !!s.panes[id]?.recording);
  const dim = useConfig((s) => s.config.window.dim_inactive);
  const paneBar = useConfig(
    (s) => s.config.statusbar.enabled && s.config.statusbar.scope === "pane",
  );

  useLayoutEffect(() => {
    const session = getSession(id);
    if (!session || !ref.current) return;
    session.mount(ref.current);
    const ro = new ResizeObserver(() => session.fit());
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [id]);

  useEffect(() => {
    getSession(id)?.setVisible(visible);
    if (visible && active) getSession(id)?.focus();
  }, [id, visible, active]);

  return (
    <div
      ref={ref}
      data-pane={id}
      className={`pane${showActive && !active ? " inactive" : ""}${paneBar ? " with-bar" : ""}`}
      style={{
        ...paneStyle(rect),
        display: visible ? undefined : "none",
        ["--dim" as string]: dim,
      }}
      onMouseDown={() => {
        if (!active) focusPane(id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const s = getSession(id);
        if (s) void showContextMenu(s, e.nativeEvent);
      }}
    >
      <div className="pane-dim" />
      {showActive && active && <div className="pane-edge" />}
      {searchOpen && <SearchBar paneId={id} />}
      {session && <StickyHeader session={session} />}
      {recording && <div className="rec-badge">REC</div>}
      {ai && <AiBar key={`${ai.mode}:${ai.blockId ?? ""}`} {...ai} />}
      {session && trail && active && visible && <CursorTrail session={session} />}
      {session && active && visible && !mode && <Suggest session={session} paneId={id} />}
      {session && mode === "hints" && <HintsOverlay session={session} />}
      {session && mode === "copy" && <CopyMode session={session} />}
      {paneBar && <StatusBar paneId={id} />}
    </div>
  );
}

function DividerHandle({
  d,
  tab,
  container,
}: {
  d: Divider;
  tab: Tab;
  container: React.RefObject<HTMLDivElement | null>;
}) {
  const [dragging, setDragging] = useState(false);
  const style: React.CSSProperties =
    d.dir === "row"
      ? { left: pct(d.rect.x), top: pct(d.rect.y), height: pct(d.rect.h) }
      : { top: pct(d.rect.y), left: pct(d.rect.x), width: pct(d.rect.w) };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = container.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    let frame = 0;
    const move = (ev: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const at =
          d.dir === "row"
            ? ((ev.clientX - box.left) / box.width - d.parent.x) / d.parent.w
            : ((ev.clientY - box.top) / box.height - d.parent.y) / d.parent.h;
        const cur = useWorkspace.getState().tabs.find((x) => x.id === tab.id);
        if (cur) {
          useWorkspace.getState().updateTab(tab.id, {
            root: setBoundary(cur.root, d.splitId, d.index, at),
          });
        }
      });
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={`divider ${d.dir}${dragging ? " dragging" : ""}`}
      style={style}
      onPointerDown={onPointerDown}
    />
  );
}
