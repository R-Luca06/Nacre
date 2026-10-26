import { create } from "zustand";
import type { ExitInfo, ProcInfo } from "../ipc/pty";
import { type LayoutNode, contains } from "../layout/tree";
import type { LaunchOptions } from "../terminal/session";
import type { AiRequestState } from "../ai/CommandBar";
import type { PaletteMode } from "../palette/Palette";
import type { PaneMode } from "../terminal/Modes";

export interface PaneMeta {
  id: string;
  launch: LaunchOptions;
  /** Last title set by the program via OSC 0/2. */
  oscTitle?: string;
  oscTitleAt?: number;
  proc?: ProcInfo;
  cwd?: string;
  /** The shell reports its cwd via OSC 7; polling must not override it. */
  cwdFromOsc?: boolean;
  exited?: ExitInfo;
  /** Profile the pane was opened with. */
  profile?: string;
  /** From shell integration (OSC 133). */
  lastCommand?: { command?: string; duration?: number; exitCode?: number; at: number };
  bell?: boolean;
  activity?: boolean;
}

export interface Tab {
  id: string;
  root: LayoutNode;
  active: string;
  zoomed: string | null;
  title?: string;
  color?: string;
  pinned?: boolean;
  broadcast?: boolean;
  /** Terminal theme for every pane of this tab. */
  theme?: string;
}

export interface ClosedTab {
  tab: Tab;
  cwds: Record<string, string | undefined>;
  profiles?: Record<string, string | undefined>;
  index: number;
}

export interface PromptRequest {
  title: string;
  placeholder?: string;
  value?: string;
  action: string;
  onSubmit: (value: string) => void;
}

export interface Confirm {
  title: string;
  detail: string;
  action: string;
  onConfirm: () => void;
}

export type Overlay =
  | { kind: "palette"; mode?: PaletteMode }
  | { kind: "snippet"; name: string; template: string; run: boolean }
  | { kind: "confirm"; confirm: Confirm }
  | { kind: "rename"; tabId: string }
  | { kind: "claude"; view?: "sessions" | "history" | "usage" }
  | { kind: "diff"; path: string; cwd: string | null }
  | { kind: "filter"; paneId: string; blockId: number }
  | { kind: "prompt"; prompt: PromptRequest }
  | { kind: "settings" }
  | null;

interface WorkspaceState {
  tabs: Tab[];
  activeTabId: string;
  panes: Record<string, PaneMeta>;
  closed: ClosedTab[];
  overlay: Overlay;
  /** Pane whose search bar is open. */
  search: string | null;
  toast: { id: number; text: string; level: "info" | "warn"; tabId?: string } | null;
  /** Side panel shown next to the panes. */
  panel: "claude" | "chat" | null;
  togglePanel: (p: "claude" | "chat") => void;
  /** Keyboard mode (hints, copy) over a pane. */
  mode: PaneMode | null;
  setMode: (m: PaneMode | null) => void;
  /** AI bar shown at the bottom of a pane. */
  ai: AiRequestState | null;
  setAi: (a: AiRequestState | null) => void;
  showToast: (text: string, level?: "info" | "warn", tabId?: string) => void;
  setTabs: (tabs: Tab[], activeTabId?: string) => void;
  updateTab: (id: string, patch: Partial<Tab>) => void;
  setActiveTab: (id: string) => void;
  addPane: (meta: PaneMeta) => void;
  updatePane: (id: string, patch: Partial<PaneMeta>) => void;
  removePanes: (ids: string[]) => void;
  pushClosed: (c: ClosedTab) => void;
  popClosed: () => ClosedTab | undefined;
  setOverlay: (o: Overlay) => void;
  setSearch: (paneId: string | null) => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  tabs: [],
  activeTabId: "",
  panes: {},
  closed: [],
  overlay: null,
  search: null,
  toast: null,
  panel: null,
  ai: null,
  mode: null,
  setMode: (mode) => set({ mode }),
  setAi: (ai) => set({ ai }),
  togglePanel: (p) => set((s) => ({ panel: s.panel === p ? null : p })),
  showToast: (text, level = "info", tabId) => {
    const id = Date.now();
    set({ toast: { id, text, level, tabId } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 5000);
  },
  setTabs: (tabs, activeTabId) => set((s) => ({ tabs, activeTabId: activeTabId ?? s.activeTabId })),
  updateTab: (id, patch) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  setActiveTab: (activeTabId) => set({ activeTabId }),
  addPane: (meta) => set((s) => ({ panes: { ...s.panes, [meta.id]: meta } })),
  updatePane: (id, patch) =>
    set((s) => {
      const cur = s.panes[id];
      if (!cur) return s;
      const changed = Object.entries(patch).some(([k, v]) => cur[k as keyof PaneMeta] !== v);
      return changed ? { panes: { ...s.panes, [id]: { ...cur, ...patch } } } : s;
    }),
  removePanes: (ids) =>
    set((s) => {
      const panes = { ...s.panes };
      for (const id of ids) delete panes[id];
      return { panes };
    }),
  pushClosed: (c) => set((s) => ({ closed: [...s.closed.slice(-19), c] })),
  popClosed: () => {
    const c = get().closed.at(-1);
    if (c) set((s) => ({ closed: s.closed.slice(0, -1) }));
    return c;
  },
  setOverlay: (overlay) => set({ overlay }),
  setSearch: (search) => set({ search }),
}));

export const activeTab = (s = useWorkspace.getState()) =>
  s.tabs.find((t) => t.id === s.activeTabId);

export const tabOfPane = (paneId: string, s = useWorkspace.getState()) =>
  s.tabs.find((t) => contains(t.root, paneId));
