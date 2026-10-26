import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  type NodeSpec,
  type TabSpec,
  type Workspace,
  isSplit,
  resolveCwd,
  tabSpecFrom,
  workspaceFromRaw,
  workspaceToToml,
} from "../config/workspaces";
import type { ThemeFile } from "../ipc/config";
import { type LayoutNode, pane, paneIds, preset } from "../layout/tree";
import { t } from "../i18n";
import { type Tab, activeTab, useWorkspace } from "../store/workspace";
import { useConfig } from "../store/config";
import { homeDir } from "./paths";
import { focusPane, makePaneFor, paneCwd, uid } from "./ops";

export const useWorkspaces = create<{ list: Workspace[] }>(() => ({ list: [] }));

function apply(files: ThemeFile[]) {
  const list: Workspace[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (f.error) {
      errors.push(f.error);
      continue;
    }
    const r = workspaceFromRaw(f.raw, f.file);
    errors.push(...r.errors);
    if (r.workspace) list.push(r.workspace);
  }
  useWorkspaces.setState({ list });
  const cfg = useConfig.getState();
  const others = cfg.extraErrors.filter((e) => !e.startsWith("workspaces/"));
  cfg.setExtraErrors([...others, ...errors]);
}

export async function initWorkspaces() {
  apply(await invoke<ThemeFile[]>("workspaces_load").catch(() => []));
  await listen<ThemeFile[]>("workspaces-changed", (e) => apply(e.payload));
}

function build(spec: NodeSpec, base: string | undefined): LayoutNode {
  if (isSplit(spec)) {
    const children = spec.children.map((c) => build(c, base));
    const n = children.length;
    const sizes = spec.sizes ?? children.map(() => 1 / n);
    const sum = sizes.reduce((a, b) => a + b, 0);
    return {
      kind: "split",
      id: uid("s"),
      dir: spec.dir,
      children,
      sizes: sizes.map((s) => s / sum),
    };
  }
  const cwd = resolveCwd(base, spec.cwd, homeDir());
  return pane(makePaneFor(cwd, spec.profile, spec.command));
}

function buildTab(spec: TabSpec, base: string | undefined): Tab {
  const tabCwd = resolveCwd(base, spec.cwd, homeDir());
  let root: LayoutNode;
  if (spec.split) {
    root = build(spec.split, tabCwd);
  } else {
    const leaves = (spec.panes ?? [{}]).map((p) => build(p, tabCwd));
    const ids = leaves.map((l) => (l.kind === "pane" ? l.id : ""));
    root = leaves.length === 1 ? leaves[0] : preset(ids, spec.layout ?? "columns", () => uid("s"));
  }
  return {
    id: uid("t"),
    root,
    active: paneIds(root)[0],
    zoomed: null,
    title: spec.title,
    color: spec.color,
  };
}

/** Opens a workspace's tabs after the current ones. */
export function openWorkspace(w: Workspace) {
  const tabs = w.tabs.map((spec) => buildTab(spec, w.cwd));
  const ws = useWorkspace.getState();
  ws.setTabs([...ws.tabs, ...tabs], tabs[0].id);
  focusPane(tabs[0].active);
}

/** Writes this window's tabs as `workspaces/<name>.toml`. */
export async function saveWorkspace(name: string) {
  const s = useWorkspace.getState();
  const root = await paneCwd(activeTab()?.active);
  const tabs = s.tabs.map((tab) => tabSpecFrom(tab, (id) => s.panes[id]?.cwd, root));
  const text = workspaceToToml({ name, cwd: root, tabs });
  try {
    const path = await invoke<string>("workspace_save", {
      file: name.toLowerCase(),
      contents: text,
    });
    s.showToast(t("Saved to {path}", { path: path.replace(homeDir(), "~") }));
  } catch (e) {
    s.showToast(String(e), "warn");
  }
}
