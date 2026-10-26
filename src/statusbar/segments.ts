import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Battery,
  BatteryCharging,
  BatteryLow,
  Box,
  Braces,
  Clock,
  Cloud,
  Container,
  Cpu,
  Asterisk,
  Folder,
  Gauge,
  GitBranch,
  MemoryStick,
  Network,
  Ship,
  type LucideIcon,
} from "lucide-react";
import type { Config, CustomSegment } from "../config/schema";
import { type PaneMeta, useWorkspace } from "../store/workspace";
import type { ClaudeSession } from "../claude/store";
import { contextLevel, formatCost, formatTokens } from "../claude/format";
import { formatDuration as fmtDur } from "./format";
import { getSession } from "../terminal/registry";
import { tildify } from "../app/paths";
import { t } from "../i18n";
import { formatBytes, formatDuration, formatTime, shortenPath } from "./format";

export type Level = "normal" | "dim" | "accent" | "ok" | "warn" | "danger";

export interface SegmentValue {
  text: string;
  icon?: LucideIcon;
  level?: Level;
  title?: string;
  /** 0..1, drawn as a thin bar before the text. */
  gauge?: number;
}

export interface SegmentContext {
  paneId?: string;
  meta?: PaneMeta;
  claude?: ClaudeSession;
  config: Config;
}

/** Ids that expand to several segments. */
const GROUPS: Record<string, string[]> = {
  claude: ["claude.state", "claude.model", "claude.context", "claude.cost"],
};

export const expandSegments = (ids: string[]) => ids.flatMap((id) => GROUPS[id] ?? [id]);

export interface SegmentDef {
  id: string;
  /** Milliseconds between refreshes; omitted = only when `deps` change. */
  interval?: number;
  deps?: (ctx: SegmentContext) => unknown[];
  compute: (ctx: SegmentContext) => SegmentValue | null | Promise<SegmentValue | null>;
  click?: (ctx: SegmentContext) => void;
}

const registry = new Map<string, SegmentDef>();

export function registerSegment(def: SegmentDef) {
  registry.set(def.id, def);
}

export function segmentDef(id: string, config: Config): SegmentDef | undefined {
  if (id.startsWith("custom:")) {
    const c = config.statusbar.custom.find((x) => x.name === id.slice(7));
    return c ? customSegment(c) : undefined;
  }
  return registry.get(id);
}

export const segmentIds = () => [...registry.keys()];

export function unregisterSegment(id: string) {
  registry.delete(id);
}

/** Runs a command in the pane's shell, only if the shell is idle. */
export function runInPane(ctx: SegmentContext, command: string) {
  if (!ctx.paneId || (ctx.meta?.proc && !ctx.meta.proc.isShell)) return;
  getSession(ctx.paneId)?.send(`${command}\r`);
}

// Shared system stats, fetched once for all stats segments.
type Stats = {
  cpu: number;
  memUsed: number;
  memTotal: number;
  battery: number | null;
  charging: boolean;
  netRx: number;
  netTx: number;
};
let stats: { at: number; value: Promise<Stats> } | null = null;
function getStats(): Promise<Stats> {
  if (!stats || Date.now() - stats.at > 1500) {
    stats = { at: Date.now(), value: invoke<Stats>("system_stats") };
  }
  return stats.value;
}

let contexts: { at: number; value: Promise<Record<string, string>> } | null = null;
function getContexts() {
  if (!contexts || Date.now() - contexts.at > 5000) {
    contexts = { at: Date.now(), value: invoke<Record<string, string>>("contexts") };
  }
  return contexts.value;
}

const cwdDeps = (ctx: SegmentContext) => [ctx.meta?.cwd];

registerSegment({
  id: "cwd",
  deps: cwdDeps,
  compute: ({ meta }) =>
    meta?.cwd ? { text: shortenPath(tildify(meta.cwd)), icon: Folder, title: meta.cwd } : null,
  click: ({ meta }) => meta?.cwd && void openPath(meta.cwd),
});

interface Git {
  branch: string;
  detached: boolean;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicts: number;
}

registerSegment({
  id: "git",
  interval: 3000,
  deps: cwdDeps,
  compute: async ({ meta }) => {
    if (!meta?.cwd) return null;
    const g = await invoke<Git | null>("git_status", { cwd: meta.cwd });
    if (!g) return null;
    const dirty = g.staged + g.modified + g.untracked > 0;
    const parts = [g.branch + (dirty ? " ●" : "")];
    if (g.ahead) parts.push(`↑${g.ahead}`);
    if (g.behind) parts.push(`↓${g.behind}`);
    return {
      text: parts.join(" "),
      icon: GitBranch,
      level: g.conflicts ? "danger" : "normal",
      title: `+${g.staged} ~${g.modified} ?${g.untracked}`,
    };
  },
  click: (ctx) => runInPane(ctx, "git status"),
});

registerSegment({
  id: "time",
  interval: 1000,
  compute: ({ config }) => ({
    text: formatTime(new Date(), config.statusbar.time_format),
    icon: Clock,
  }),
});

registerSegment({
  id: "process",
  deps: (ctx) => [ctx.meta?.proc?.name, ctx.meta?.proc?.isShell, ctx.meta?.lastCommand],
  compute: ({ meta }) => {
    const parts: string[] = [];
    let level: Level = "normal";
    if (meta?.proc && !meta.proc.isShell) parts.push(meta.proc.name);
    const last = meta?.lastCommand;
    if (last && (!meta?.proc || meta.proc.isShell)) {
      if (last.duration !== undefined && last.duration >= 2000)
        parts.push(formatDuration(last.duration));
      if (last.exitCode) {
        parts.push(`✗ ${last.exitCode}`);
        level = "danger";
      }
    }
    return parts.length ? { text: parts.join(" · "), level } : null;
  },
});

const pctLevel = (v: number, warn: number, danger: number): Level =>
  v >= danger ? "danger" : v >= warn ? "warn" : "normal";

registerSegment({
  id: "cpu",
  interval: 2000,
  compute: async () => {
    const s = await getStats();
    return { text: `${Math.round(s.cpu)}%`, icon: Cpu, level: pctLevel(s.cpu, 70, 90) };
  },
});

registerSegment({
  id: "mem",
  interval: 3000,
  compute: async () => {
    const s = await getStats();
    const ratio = (s.memUsed / s.memTotal) * 100;
    return {
      text: `${formatBytes(s.memUsed)}/${formatBytes(s.memTotal, 0)}`,
      icon: MemoryStick,
      level: pctLevel(ratio, 80, 92),
    };
  },
});

registerSegment({
  id: "battery",
  interval: 30000,
  compute: async () => {
    const s = await getStats();
    if (s.battery === null) return null;
    const low = s.battery <= 15 && !s.charging;
    return {
      text: `${s.battery}%`,
      icon: s.charging ? BatteryCharging : low ? BatteryLow : Battery,
      level: low ? "danger" : "normal",
    };
  },
});

registerSegment({
  id: "net",
  interval: 2000,
  compute: async () => {
    const s = await getStats();
    return { text: `↓${formatBytes(s.netRx)} ↑${formatBytes(s.netTx)}`, icon: Network };
  },
});

registerSegment({
  id: "tools",
  interval: 60000,
  deps: cwdDeps,
  compute: async ({ meta }) => {
    if (!meta?.cwd) return null;
    const tools = await invoke<{ name: string; version: string }[]>("project_tools", {
      cwd: meta.cwd,
    });
    if (!tools.length) return null;
    return { text: tools.map((t) => `${t.name} ${t.version}`).join(" · "), icon: Box };
  },
});

registerSegment({
  id: "kube",
  interval: 5000,
  compute: async () => {
    const c = await getContexts();
    return c.kube ? { text: c.kube, icon: Ship } : null;
  },
});

registerSegment({
  id: "docker",
  interval: 5000,
  compute: async () => {
    const c = await getContexts();
    return c.docker ? { text: c.docker, icon: Container } : null;
  },
});

const envSegment = (
  id: string,
  keys: string[],
  icon: LucideIcon,
  fmt: (env: Record<string, string>) => string | undefined,
) =>
  registerSegment({
    id,
    interval: 5000,
    deps: (ctx) => [ctx.paneId, ctx.meta?.proc?.pid],
    compute: async ({ paneId }) => {
      if (!paneId) return null;
      const env = await invoke<Record<string, string>>("pane_env", { id: paneId, keys });
      const text = fmt(env);
      return text ? { text, icon } : null;
    },
  });

envSegment("aws", ["AWS_PROFILE", "AWS_VAULT"], Cloud, (e) => e.AWS_VAULT ?? e.AWS_PROFILE);
envSegment(
  "venv",
  ["VIRTUAL_ENV", "CONDA_DEFAULT_ENV"],
  Braces,
  (e) => e.VIRTUAL_ENV?.split("/").pop() ?? e.CONDA_DEFAULT_ENV,
);

function customSegment(c: CustomSegment): SegmentDef {
  return {
    id: `custom:${c.name}`,
    interval: c.interval * 1000,
    deps: cwdDeps,
    compute: async ({ meta }) => {
      const out = await invoke<string | null>("run_script", {
        command: c.command,
        cwd: meta?.cwd ?? null,
        timeout: 5000,
      });
      if (!out) return null;
      const level: Level =
        c.danger && new RegExp(c.danger).test(out)
          ? "danger"
          : c.warn && new RegExp(c.warn).test(out)
            ? "warn"
            : "normal";
      return { text: out, level };
    },
    click: c.click ? (ctx) => runInPane(ctx, c.click!) : undefined,
  };
}

// Claude

const claudeDeps = (ctx: SegmentContext) => {
  const c = ctx.claude;
  return c
    ? [
        c.id,
        c.state,
        c.tool,
        c.modelName,
        c.contextTokens,
        c.contextWindow,
        c.costUsd,
        c.rateLimits,
        c.attention,
      ]
    : [null];
};

const STATE_TEXT: Record<string, string> = {
  thinking: "Thinking",
  tool: "",
  permission: "Permission",
  done: "Done",
  compacting: "Compacting",
};

registerSegment({
  id: "claude.state",
  deps: claudeDeps,
  compute: ({ claude: c }) => {
    if (!c || c.state === "idle" || c.state === "ended") return null;
    const text = c.state === "tool" ? (c.tool ?? "Tool") : STATE_TEXT[c.state];
    const level: Level = c.state === "permission" ? "warn" : c.state === "done" ? "ok" : "accent";
    return { text: t(text), icon: Asterisk, level, title: c.message ?? undefined };
  },
});

registerSegment({
  id: "claude.model",
  deps: claudeDeps,
  compute: ({ claude: c }) =>
    c?.modelName ? { text: c.modelName, icon: c.state === "idle" ? Asterisk : undefined } : null,
});

registerSegment({
  id: "claude.context",
  deps: claudeDeps,
  compute: ({ claude: c, config }) => {
    if (!c || !c.contextTokens) return null;
    const pct = c.contextPct;
    const level = contextLevel(pct, config.claude.context_warn, config.claude.context_danger);
    const tt = c.totals;
    return {
      text: `${Math.round(pct)}% · ${formatTokens(c.contextTokens)}/${formatTokens(c.contextWindow)}`,
      gauge: Math.min(1, pct / 100),
      level,
      title: `in ${formatTokens(tt.input)} · out ${formatTokens(tt.output)} · cache read ${formatTokens(tt.cacheRead)} · cache write ${formatTokens(tt.cacheWrite)}`,
    };
  },
  click: () => openDashboard(),
});

registerSegment({
  id: "claude.cost",
  deps: claudeDeps,
  compute: ({ claude: c }) => {
    if (!c || !c.costUsd) return null;
    const dur = c.durationMs ?? Date.now() - c.startedAt;
    return {
      text: formatCost(c.costUsd, c.costExact),
      title: `${fmtDur(dur)} · ${c.prompts} prompts`,
    };
  },
  click: () => openDashboard(),
});

registerSegment({
  id: "claude.limits",
  deps: claudeDeps,
  compute: ({ claude: c }) => {
    const r = c?.rateLimits;
    if (!r || (r.fiveHourPct == null && r.sevenDayPct == null)) return null;
    const parts: string[] = [];
    if (r.fiveHourPct != null) parts.push(`5h ${Math.round(r.fiveHourPct)}%`);
    if (r.sevenDayPct != null) parts.push(`7d ${Math.round(r.sevenDayPct)}%`);
    const max = Math.max(r.fiveHourPct ?? 0, r.sevenDayPct ?? 0);
    return {
      text: parts.join(" · "),
      icon: Gauge,
      level: max >= 90 ? "danger" : max >= 75 ? "warn" : "normal",
    };
  },
});

registerSegment({
  id: "claude.duration",
  interval: 10000,
  deps: claudeDeps,
  compute: ({ claude: c }) =>
    c ? { text: `${fmtDur(c.durationMs ?? Date.now() - c.startedAt)} · ${c.prompts}` } : null,
});

const openDashboard = () => useWorkspace.getState().setOverlay({ kind: "claude" });
