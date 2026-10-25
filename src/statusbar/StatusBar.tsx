import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { useConfig } from "../store/config";
import { activeTab, useWorkspace } from "../store/workspace";
import {
  type SegmentContext,
  type SegmentDef,
  type SegmentValue,
  expandSegments,
  segmentDef,
} from "./segments";
import { useSessionForPane } from "../claude/store";
import "./statusbar.css";

function useSegmentValue(def: SegmentDef, ctx: SegmentContext): SegmentValue | null {
  const [value, setValue] = useState<SegmentValue | null>(null);
  const latest = useRef(ctx);
  useEffect(() => {
    latest.current = ctx;
  });
  const deps = def.deps?.(ctx) ?? [];
  const key = JSON.stringify(deps);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const v = await def.compute(latest.current);
        if (alive) setValue(v);
      } catch {
        if (alive) setValue(null);
      }
    };
    void run();
    const timer = def.interval ? window.setInterval(() => void run(), def.interval) : 0;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [def, key, ctx.config]);
  return value;
}

function Segment({ def, ctx }: { def: SegmentDef; ctx: SegmentContext }) {
  const value = useSegmentValue(def, ctx);
  if (!value?.text) return null;
  const click = def.click;
  return (
    <div
      className={`seg ${value.level ?? "normal"}${click ? " clickable" : ""}`}
      title={value.title}
      onClick={click ? () => click(ctx) : undefined}
    >
      {value.icon && createElement(value.icon, { size: 12, strokeWidth: 1.5 })}
      {value.gauge !== undefined && (
        <span className="gauge">
          <span style={{ width: `${Math.round(value.gauge * 100)}%` }} />
        </span>
      )}
      <span>{value.text}</span>
    </div>
  );
}

function Zone({ ids, ctx, side }: { ids: string[]; ctx: SegmentContext; side: string }) {
  const defs = expandSegments(ids)
    .map((id) => segmentDef(id, ctx.config))
    .filter((d): d is SegmentDef => d !== undefined);
  return (
    <div className={`zone ${side}`}>
      {defs.map((d) => (
        <Segment key={d.id} def={d} ctx={ctx} />
      ))}
    </div>
  );
}

/** Window bar follows the active pane; pane bars pass their own `paneId`. */
export function StatusBar({ paneId }: { paneId?: string }) {
  const config = useConfig((s) => s.config);
  const activeId = useWorkspace((s) => (paneId ? paneId : activeTab(s)?.active));
  const meta = useWorkspace((s) => (activeId ? s.panes[activeId] : undefined));
  const claude = useSessionForPane(activeId);
  const ctx = useMemo<SegmentContext>(
    () => ({ paneId: activeId, meta, claude, config }),
    [activeId, meta, claude, config],
  );
  const sb = config.statusbar;
  return (
    <div className={`statusbar ${sb.style} ${sb.position}${paneId ? " pane-bar" : ""}`}>
      <Zone ids={sb.left} ctx={ctx} side="left" />
      <Zone ids={sb.center} ctx={ctx} side="center" />
      <Zone ids={sb.right} ctx={ctx} side="right" />
    </div>
  );
}
