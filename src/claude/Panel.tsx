import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Circle, CircleDot, X } from "lucide-react";
import { t } from "../i18n";
import { useConfig } from "../store/config";
import { activeTab, useWorkspace } from "../store/workspace";
import { type ClaudeSession, useSessionForPane } from "./store";
import { contextLevel, formatCost, formatTokens } from "./format";
import "./panel.css";

/** Context tokens over the session, with warn/danger thresholds. */
function ContextGraph({ s }: { s: ClaudeSession }) {
  const cfg = useConfig((c) => c.config.claude);
  const points = s.timeline;
  const w = 268;
  const h = 56;
  const max = s.contextWindow || 1;
  const path = useMemo(() => {
    if (points.length < 2) return "";
    return points
      .map(([, v], i) => {
        const x = (i / (points.length - 1)) * w;
        const y = h - Math.min(1, v / max) * h;
        return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [points, max]);
  const y = (pct: number) => h - (pct / 100) * h;
  return (
    <svg className="ctx-graph" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
      <line x1={0} x2={w} y1={y(cfg.context_warn)} y2={y(cfg.context_warn)} className="warn" />
      <line
        x1={0}
        x2={w}
        y1={y(cfg.context_danger)}
        y2={y(cfg.context_danger)}
        className="danger"
      />
      {path && <path d={path} />}
    </svg>
  );
}

function rel(path: string, cwd: string | null): string {
  return cwd && path.startsWith(cwd + "/") ? path.slice(cwd.length + 1) : path;
}

export function ClaudePanel() {
  const paneId = useWorkspace((s) => activeTab(s)?.active);
  const s = useSessionForPane(paneId);
  const cfg = useConfig((c) => c.config.claude);

  return (
    <aside className="claude-panel">
      {!s ? (
        <div className="cp-empty">{t("No Claude session in this pane.")}</div>
      ) : (
        <>
          <section>
            <div className="cp-title">{s.title ?? s.firstPrompt ?? t("Claude")}</div>
            <div className="sub">
              {s.modelName ?? "—"} · {formatCost(s.costUsd, s.costExact)} · {s.prompts}{" "}
              {t("prompts")}
            </div>
          </section>
          <section>
            <div className="cp-head">
              <span>{t("Context")}</span>
              <span className={contextLevel(s.contextPct, cfg.context_warn, cfg.context_danger)}>
                {Math.round(s.contextPct)}% · {formatTokens(s.contextTokens)}/
                {formatTokens(s.contextWindow)}
              </span>
            </div>
            <ContextGraph s={s} />
          </section>
          {s.todos.length > 0 && (
            <section>
              <div className="cp-head">
                <span>{t("Tasks")}</span>
                <span>
                  {s.todos.filter((x) => x.status === "completed").length}/{s.todos.length}
                </span>
              </div>
              <ul className="cp-todos">
                {s.todos.map((todo, i) => (
                  <li key={i} className={todo.status}>
                    {todo.status === "completed" ? (
                      <Check size={12} strokeWidth={1.5} />
                    ) : todo.status === "in_progress" ? (
                      <CircleDot size={12} strokeWidth={1.5} />
                    ) : (
                      <Circle size={12} strokeWidth={1.5} />
                    )}
                    <span>
                      {todo.status === "in_progress" && todo.activeForm
                        ? todo.activeForm
                        : todo.content}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {s.files.length > 0 && (
            <section>
              <div className="cp-head">
                <span>{t("Files")}</span>
                <span>{s.files.length}</span>
              </div>
              <ul className="cp-files">
                {s.files.map((f) => (
                  <li key={f}>
                    <button
                      onClick={() =>
                        useWorkspace.getState().setOverlay({ kind: "diff", path: f, cwd: s.cwd })
                      }
                      title={f}
                    >
                      {rel(f, s.cwd)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </aside>
  );
}

function lineClass(l: string): string {
  if (l.startsWith("+++") || l.startsWith("---")) return "meta";
  if (l.startsWith("+")) return "add";
  if (l.startsWith("-")) return "del";
  if (l.startsWith("@@")) return "hunk";
  if (l.startsWith("diff ") || l.startsWith("index ")) return "meta";
  return "";
}

export function DiffView({ path, cwd }: { path: string; cwd: string | null }) {
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => {
    const dir = cwd ?? path.slice(0, path.lastIndexOf("/"));
    void invoke<string>("git_diff", { cwd: dir, path }).then(setDiff, () => setDiff(""));
  }, [path, cwd]);
  const close = () => useWorkspace.getState().setOverlay(null);
  return (
    <div
      className="scrim"
      onMouseDown={close}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <div className="diff popover" onMouseDown={(e) => e.stopPropagation()} tabIndex={-1}>
        <header>
          <span title={path}>{rel(path, cwd)}</span>
          <button className="icon-btn" onClick={close}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </header>
        <pre>
          {diff === null
            ? ""
            : diff === ""
              ? t("No changes.")
              : diff.split("\n").map((l, i) => (
                  <div key={i} className={lineClass(l)}>
                    {l || " "}
                  </div>
                ))}
        </pre>
      </div>
    </div>
  );
}
