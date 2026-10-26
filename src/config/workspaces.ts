import { stringify } from "smol-toml";
import type { Dir, LayoutNode, Preset } from "../layout/tree";

export interface PaneSpec {
  cwd?: string;
  command?: string;
  profile?: string;
}

export interface SplitSpec {
  dir: Dir;
  sizes?: number[];
  children: NodeSpec[];
}

export type NodeSpec = PaneSpec | SplitSpec;

export interface TabSpec {
  title?: string;
  color?: string;
  cwd?: string;
  /** Either a preset over `panes`… */
  layout?: Preset;
  panes?: PaneSpec[];
  /** …or an explicit tree. */
  split?: SplitSpec;
}

export interface Workspace {
  name: string;
  file: string;
  cwd?: string;
  tabs: TabSpec[];
}

export const isSplit = (n: NodeSpec): n is SplitSpec => "children" in n;

const PRESETS: Preset[] = ["columns", "rows", "grid", "main-stack"];

function pane(raw: unknown, at: string, errors: string[]): PaneSpec | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${at}: expected a table`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  const out: PaneSpec = {};
  for (const k of ["cwd", "command", "profile"] as const) {
    if (r[k] === undefined) continue;
    if (typeof r[k] === "string") out[k] = r[k] as string;
    else errors.push(`${at}.${k}: expected a string`);
  }
  return out;
}

function node(raw: unknown, at: string, errors: string[]): NodeSpec | null {
  if (raw && typeof raw === "object" && "children" in (raw as object)) {
    const r = raw as Record<string, unknown>;
    if (r.dir !== "row" && r.dir !== "column") {
      errors.push(`${at}.dir: use row or column`);
      return null;
    }
    if (!Array.isArray(r.children) || r.children.length === 0) {
      errors.push(`${at}.children: expected a non-empty list`);
      return null;
    }
    const children = r.children
      .map((c, i) => node(c, `${at}.children[${i}]`, errors))
      .filter((c): c is NodeSpec => c !== null);
    const sizes =
      Array.isArray(r.sizes) &&
      r.sizes.length === children.length &&
      r.sizes.every((s) => typeof s === "number" && s > 0)
        ? (r.sizes as number[])
        : undefined;
    return children.length ? { dir: r.dir, sizes, children } : null;
  }
  return pane(raw, at, errors);
}

export function workspaceFromRaw(
  raw: unknown,
  file: string,
): { workspace?: Workspace; errors: string[] } {
  const errors: string[] = [];
  const at = `workspaces/${file}`;
  if (!raw || typeof raw !== "object") return { errors: [`${at}: not a table`] };
  const r = raw as Record<string, unknown>;
  const name =
    typeof r.name === "string" && r.name.trim() ? r.name.trim() : file.replace(/\.toml$/, "");
  const tabsRaw = r.tab ?? r.tabs;
  if (!Array.isArray(tabsRaw) || tabsRaw.length === 0) {
    return { errors: [`${at}: add at least one [[tab]]`] };
  }
  const tabs: TabSpec[] = [];
  tabsRaw.forEach((t, i) => {
    const tat = `${at} tab ${i + 1}`;
    if (!t || typeof t !== "object") {
      errors.push(`${tat}: expected a table`);
      return;
    }
    const tr = t as Record<string, unknown>;
    const spec: TabSpec = {};
    if (typeof tr.title === "string") spec.title = tr.title;
    if (typeof tr.color === "string") spec.color = tr.color;
    if (typeof tr.cwd === "string") spec.cwd = tr.cwd;
    if (tr.split !== undefined) {
      const s = node(tr.split, `${tat}.split`, errors);
      if (s && isSplit(s)) spec.split = s;
      else if (s) spec.panes = [s];
    } else {
      const panes = Array.isArray(tr.panes)
        ? tr.panes
            .map((p, j) => pane(p, `${tat}.panes[${j}]`, errors))
            .filter((p): p is PaneSpec => p !== null)
        : [{ command: typeof tr.command === "string" ? tr.command : undefined }];
      spec.panes = panes.length ? panes : [{}];
      if (tr.layout !== undefined) {
        if (PRESETS.includes(tr.layout as Preset)) spec.layout = tr.layout as Preset;
        else errors.push(`${tat}.layout: use one of ${PRESETS.join(", ")}`);
      }
    }
    tabs.push(spec);
  });
  return {
    workspace: { name, file, cwd: typeof r.cwd === "string" ? r.cwd : undefined, tabs },
    errors,
  };
}

/** Relative paths resolve against the parent; `~` expands to home. */
export function resolveCwd(
  base: string | undefined,
  rel: string | undefined,
  home: string,
): string | undefined {
  const expand = (p: string) => p.replace(/^~(?=\/|$)/, home);
  if (!rel) return base ? expand(base) : undefined;
  const r = expand(rel);
  if (r.startsWith("/")) return r;
  return base ? `${expand(base).replace(/\/$/, "")}/${r}` : r;
}

/** Turns a live tab into a spec; directories are kept relative to `root` when inside it. */
export function tabSpecFrom(
  tab: { title?: string; color?: string; root: LayoutNode },
  cwdOf: (paneId: string) => string | undefined,
  root: string | undefined,
): TabSpec {
  const rel = (p: string | undefined) => {
    if (!p || !root) return p;
    if (p === root) return undefined;
    return p.startsWith(root + "/") ? p.slice(root.length + 1) : p;
  };
  const conv = (n: LayoutNode): NodeSpec =>
    n.kind === "pane"
      ? { cwd: rel(cwdOf(n.id)) }
      : {
          dir: n.dir,
          sizes: n.sizes.map((s) => Math.round(s * 1000) / 1000),
          children: n.children.map(conv),
        };
  const spec: TabSpec = { title: tab.title, color: tab.color };
  const r = conv(tab.root);
  if (isSplit(r)) spec.split = r;
  else spec.panes = [r];
  return spec;
}

const clean = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .map(([k, x]) => [k, clean(x)]),
    );
  }
  return v;
};

export function workspaceToToml(w: Omit<Workspace, "file">): string {
  return (
    stringify(clean({ name: w.name, cwd: w.cwd, tab: w.tabs }) as Record<string, unknown>) + "\n"
  );
}
