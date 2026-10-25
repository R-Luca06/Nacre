import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

export type ClaudeState =
  "idle" | "thinking" | "tool" | "permission" | "done" | "compacting" | "ended";

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed" | string;
  activeForm?: string;
}

export interface ClaudeSession {
  id: string;
  paneId: string | null;
  cwd: string | null;
  transcriptPath: string | null;
  title: string | null;
  model: string | null;
  modelName: string | null;
  state: ClaudeState;
  tool: string | null;
  message: string | null;
  attention: boolean;
  startedAt: number;
  updatedAt: number;
  contextTokens: number;
  contextWindow: number;
  contextPct: number;
  costUsd: number;
  costExact: boolean;
  durationMs: number | null;
  prompts: number;
  linesAdded: number | null;
  linesRemoved: number | null;
  rateLimits: {
    fiveHourPct: number | null;
    fiveHourResetsAt: number | null;
    sevenDayPct: number | null;
    sevenDayResetsAt: number | null;
  } | null;
  detected: boolean;
  totals: { input: number; output: number; cacheRead: number; cacheWrite: number };
  todos: Todo[];
  files: string[];
  timeline: [number, number][];
  firstPrompt: string | null;
}

export interface Attention {
  sessionId: string;
  paneId: string | null;
  kind: "done" | "permission" | "input";
  title: string;
  message: string;
}

interface ClaudeStore {
  sessions: ClaudeSession[];
  set: (s: ClaudeSession[]) => void;
}

export const useClaude = create<ClaudeStore>((set) => ({
  sessions: [],
  set: (sessions) => set({ sessions }),
}));

/** The live session in a pane, if any. */
export function sessionForPane(
  paneId: string | undefined,
  sessions = useClaude.getState().sessions,
) {
  if (!paneId) return undefined;
  return sessions.find((s) => s.paneId === paneId && s.state !== "ended");
}

export const useSessionForPane = (paneId: string | undefined) =>
  useClaude((s) => sessionForPane(paneId, s.sessions));

export async function initClaudeStore(onAttention: (a: Attention) => void) {
  useClaude.getState().set(await invoke<ClaudeSession[]>("claude_sessions").catch(() => []));
  await listen<ClaudeSession[]>("claude-sessions", (e) => useClaude.getState().set(e.payload));
  await listen<Attention>("claude-attention", (e) => onAttention(e.payload));
}

export const ackPane = (pane: string) => void invoke("claude_ack", { pane }).catch(() => {});
export const detectClaude = (pane: string, cwd: string) =>
  invoke<string | null>("claude_detect", { pane, cwd }).catch(() => null);
export const releasePane = (pane: string) =>
  void invoke("claude_release", { pane }).catch(() => {});
