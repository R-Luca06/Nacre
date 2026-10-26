import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Asterisk, Play, X } from "lucide-react";
import { t } from "../i18n";
import { useConfig } from "../store/config";
import { activeTab, useWorkspace } from "../store/workspace";
import { baseName } from "../app/paths";
import { focusPane, newTab } from "../app/ops";
import { formatDuration } from "../statusbar/format";
import { type ClaudeSession, useClaude } from "./store";
import { contextLevel, formatCost, formatTokens } from "./format";
import { connectClaude, useInstallStatus } from "./install";
import { useNow } from "../util/useNow";
import "./dashboard.css";

type View = "sessions" | "history" | "usage";

interface PastSession {
  id: string;
  path: string;
  cwd: string | null;
  title: string | null;
  firstPrompt: string | null;
  modified: number;
  prompts: number;
}

interface UsageRow {
  day: string;
  project: string;
  model: string;
  modelName: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

const close = () => {
  useWorkspace.getState().setOverlay(null);
  const tab = activeTab();
  if (tab) focusPane(tab.active);
};

export function Dashboard({ initial = "sessions" }: { initial?: View }) {
  const [view, setView] = useState<View>(initial);
  const install = useInstallStatus();

  return (
    <div
      className="scrim"
      onMouseDown={close}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <div className="dashboard popover" onMouseDown={(e) => e.stopPropagation()} tabIndex={-1}>
        <header>
          <Asterisk size={14} strokeWidth={1.5} className="dash-mark" />
          <nav>
            {(["sessions", "history", "usage"] as View[]).map((v) => (
              <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                {t({ sessions: "Sessions", history: "History", usage: "Usage" }[v])}
              </button>
            ))}
          </nav>
          <button className="icon-btn" onClick={close}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </header>
        <div className="dash-body">
          {view === "sessions" && <Sessions />}
          {view === "history" && <History />}
          {view === "usage" && <Usage />}
        </div>
        {install && !install.hooks && (
          <footer>
            <span>{t("Hooks not connected: live state and notifications are limited.")}</span>
            <button className="btn" onClick={() => void connectClaude()}>
              {t("Connect")}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function stateLabel(s: ClaudeSession): string {
  switch (s.state) {
    case "thinking":
      return t("Thinking");
    case "tool":
      return s.tool ?? t("Tool");
    case "permission":
      return t("Permission");
    case "done":
      return t("Done");
    case "compacting":
      return t("Compacting");
    default:
      return t("Waiting");
  }
}

function Sessions() {
  const sessions = useClaude((s) => s.sessions);
  const cfg = useConfig((s) => s.config.claude);
  const now = useNow(5000);
  const live = sessions.filter((s) => s.state !== "ended");
  if (!live.length) return <div className="dash-empty">{t("No Claude session running.")}</div>;
  return (
    <table className="dash-table">
      <tbody>
        {live.map((s) => {
          const level = contextLevel(s.contextPct, cfg.context_warn, cfg.context_danger);
          return (
            <tr
              key={s.id}
              className={s.paneId ? "clickable" : ""}
              onClick={() => {
                if (!s.paneId) return;
                if (useWorkspace.getState().panes[s.paneId]) {
                  useWorkspace.getState().setOverlay(null);
                  focusPane(s.paneId);
                } else {
                  void invoke("pane_focus", { pane: s.paneId });
                }
              }}
            >
              <td className="state">
                <span className={`dot ${s.attention ? "attention" : s.state}`} />
                {stateLabel(s)}
              </td>
              <td className="title">
                <div>{s.title ?? s.firstPrompt ?? baseName(s.cwd ?? "")}</div>
                <div className="sub">
                  {baseName(s.cwd ?? "")} · {s.modelName ?? "—"}
                </div>
              </td>
              <td className={`ctx ${level}`}>
                <span className="gauge">
                  <span style={{ width: `${Math.min(100, s.contextPct)}%` }} />
                </span>
                {Math.round(s.contextPct)}%
              </td>
              <td className="num">{formatCost(s.costUsd, s.costExact)}</td>
              <td className="num dim">{formatDuration(s.durationMs ?? now - s.startedAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function relTime(ms: number): string {
  const d = (Date.now() - ms) / 1000;
  if (d < 3600) return t("{n} min ago", { n: Math.max(1, Math.round(d / 60)) });
  if (d < 86400) return t("{n} h ago", { n: Math.round(d / 3600) });
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function History() {
  const tab = activeTab();
  const cwd = useWorkspace((s) => (tab ? s.panes[tab.active]?.cwd : undefined));
  const [all, setAll] = useState(false);
  const [items, setItems] = useState<PastSession[] | null>(null);

  useEffect(() => {
    let alive = true;
    void invoke<PastSession[]>("claude_history", {
      cwd: all ? null : (cwd ?? null),
      limit: 60,
    }).then(
      (r) => alive && setItems(r),
      () => alive && setItems([]),
    );
    return () => {
      alive = false;
    };
  }, [all, cwd]);

  const resume = (s: PastSession) => {
    close();
    void newTab({ cwd: s.cwd ?? cwd, command: `claude --resume ${s.id}` });
  };

  return (
    <>
      <div className="dash-filter">
        <button className={!all ? "on" : ""} onClick={() => setAll(false)}>
          {baseName(cwd ?? "") || t("This project")}
        </button>
        <button className={all ? "on" : ""} onClick={() => setAll(true)}>
          {t("All projects")}
        </button>
      </div>
      {items === null ? null : items.length === 0 ? (
        <div className="dash-empty">{t("No past sessions.")}</div>
      ) : (
        <table className="dash-table">
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => resume(s)}>
                <td className="title">
                  <div>{s.title ?? s.firstPrompt ?? s.id}</div>
                  {all && <div className="sub">{baseName(s.cwd ?? "")}</div>}
                </td>
                <td className="num dim">{s.prompts}</td>
                <td className="num dim">{relTime(s.modified)}</td>
                <td className="act">
                  <Play size={12} strokeWidth={1.5} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function sum(rows: UsageRow[]) {
  return rows.reduce(
    (a, r) => ({
      cost: a.cost + r.costUsd,
      tokens: a.tokens + r.input + r.output + r.cacheRead + r.cacheWrite,
    }),
    { cost: 0, tokens: 0 },
  );
}

function localDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Usage() {
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  useEffect(() => {
    void invoke<UsageRow[]>("claude_usage").then(setRows, () => setRows([]));
  }, []);

  const data = useMemo(() => {
    if (!rows) return null;
    const days = Array.from({ length: 14 }, (_, i) => localDay(13 - i));
    const byDay = days.map((d) => ({ day: d, ...sum(rows.filter((r) => r.day === d)) }));
    const since = (n: number) => sum(rows.filter((r) => r.day >= localDay(n - 1)));
    const group = (key: (r: UsageRow) => string, from: string) => {
      const m = new Map<string, UsageRow[]>();
      for (const r of rows.filter((x) => x.day >= from)) {
        const k = key(r);
        m.set(k, [...(m.get(k) ?? []), r]);
      }
      return [...m.entries()]
        .map(([k, v]) => ({ k, ...sum(v) }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 6);
    };
    const from30 = localDay(29);
    return {
      byDay,
      today: since(1),
      week: since(7),
      month: since(30),
      models: group((r) => r.modelName, from30),
      projects: group((r) => r.project, from30),
    };
  }, [rows]);

  if (!data) return <div className="dash-empty">{t("Reading transcripts…")}</div>;
  const max = Math.max(...data.byDay.map((d) => d.cost), 0.01);
  return (
    <div className="usage">
      <div className="usage-totals">
        {[
          [t("Today"), data.today],
          [t("7 days"), data.week],
          [t("30 days"), data.month],
        ].map(([label, v]) => (
          <div key={label as string}>
            <div className="sub">{label as string}</div>
            <div className="big">{formatCost((v as { cost: number }).cost, false)}</div>
            <div className="sub">{formatTokens((v as { tokens: number }).tokens)} tokens</div>
          </div>
        ))}
      </div>
      <div className="bars" title={t("Estimated cost per day")}>
        {data.byDay.map((d) => (
          <div key={d.day} className="bar" title={`${d.day} · ${formatCost(d.cost, false)}`}>
            <span style={{ height: `${(d.cost / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="usage-cols">
        {[
          [t("Models"), data.models],
          [t("Projects"), data.projects],
        ].map(([label, list]) => (
          <div key={label as string}>
            <div className="sub">
              {label as string} · {t("30 days")}
            </div>
            {(list as { k: string; cost: number }[]).map((x) => (
              <div key={x.k} className="usage-row">
                <span>{x.k}</span>
                <span className="dim">{formatCost(x.cost, false)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
