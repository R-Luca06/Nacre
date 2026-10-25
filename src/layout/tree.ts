/** `row`: children side by side. `column`: children stacked. */
export type Dir = "row" | "column";
export type Side = "left" | "right" | "up" | "down";

export interface PaneNode {
  kind: "pane";
  id: string;
}

export interface SplitNode {
  kind: "split";
  id: string;
  dir: Dir;
  children: LayoutNode[];
  /** Fractions summing to 1. */
  sizes: number[];
}

export type LayoutNode = PaneNode | SplitNode;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Divider {
  splitId: string;
  index: number;
  dir: Dir;
  /** Position of the boundary and the extent of the parent split, normalized. */
  rect: Rect;
  parent: Rect;
}

const MIN = 0.05;

export const pane = (id: string): PaneNode => ({ kind: "pane", id });

export function paneIds(node: LayoutNode): string[] {
  return node.kind === "pane" ? [node.id] : node.children.flatMap(paneIds);
}

export function contains(node: LayoutNode, id: string): boolean {
  return node.kind === "pane" ? node.id === id : node.children.some((c) => contains(c, id));
}

function normalize(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0) || 1;
  return sizes.map((s) => s / sum);
}

const sideDir = (side: Side): Dir => (side === "left" || side === "right" ? "row" : "column");
const sideAfter = (side: Side) => side === "right" || side === "down";

/** Splits `target`, placing `newId` on `side` of it. Same-direction parents get a new sibling. */
export function split(
  root: LayoutNode,
  target: string,
  side: Side,
  newId: string,
  splitId: string,
): LayoutNode {
  const dir = sideDir(side);
  const after = sideAfter(side);
  const fresh = pane(newId);

  const visit = (node: LayoutNode): LayoutNode => {
    if (node.kind === "pane") {
      if (node.id !== target) return node;
      return {
        kind: "split",
        id: splitId,
        dir,
        children: after ? [node, fresh] : [fresh, node],
        sizes: [0.5, 0.5],
      };
    }
    const idx = node.children.findIndex((c) => c.kind === "pane" && c.id === target);
    if (idx >= 0 && node.dir === dir) {
      const children = [...node.children];
      const sizes = [...node.sizes];
      const half = sizes[idx] / 2;
      const at = after ? idx + 1 : idx;
      sizes[idx] = half;
      children.splice(at, 0, fresh);
      sizes.splice(at, 0, half);
      return { ...node, children, sizes };
    }
    return { ...node, children: node.children.map(visit) };
  };
  return visit(root);
}

/** Removes a pane; single-child splits collapse into their child. */
export function remove(root: LayoutNode, id: string): LayoutNode | null {
  if (root.kind === "pane") return root.id === id ? null : root;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  root.children.forEach((c, i) => {
    const next = remove(c, id);
    if (next) {
      children.push(next);
      sizes.push(root.sizes[i]);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  // Merge nested splits of the same direction.
  const flatC: LayoutNode[] = [];
  const flatS: number[] = [];
  children.forEach((c, i) => {
    if (c.kind === "split" && c.dir === root.dir) {
      c.children.forEach((cc, j) => {
        flatC.push(cc);
        flatS.push(sizes[i] * c.sizes[j]);
      });
    } else {
      flatC.push(c);
      flatS.push(sizes[i]);
    }
  });
  return { ...root, children: flatC, sizes: normalize(flatS) };
}

export function rects(root: LayoutNode, area: Rect = { x: 0, y: 0, w: 1, h: 1 }) {
  const out = new Map<string, Rect>();
  const walk = (node: LayoutNode, r: Rect) => {
    if (node.kind === "pane") {
      out.set(node.id, r);
      return;
    }
    let offset = 0;
    node.children.forEach((c, i) => {
      const s = node.sizes[i];
      const cr =
        node.dir === "row"
          ? { x: r.x + offset * r.w, y: r.y, w: s * r.w, h: r.h }
          : { x: r.x, y: r.y + offset * r.h, w: r.w, h: s * r.h };
      offset += s;
      walk(c, cr);
    });
  };
  walk(root, area);
  return out;
}

export function dividers(root: LayoutNode, area: Rect = { x: 0, y: 0, w: 1, h: 1 }): Divider[] {
  const out: Divider[] = [];
  const walk = (node: LayoutNode, r: Rect) => {
    if (node.kind === "pane") return;
    let offset = 0;
    node.children.forEach((c, i) => {
      const s = node.sizes[i];
      const cr =
        node.dir === "row"
          ? { x: r.x + offset * r.w, y: r.y, w: s * r.w, h: r.h }
          : { x: r.x, y: r.y + offset * r.h, w: r.w, h: s * r.h };
      offset += s;
      if (i < node.children.length - 1) {
        out.push({
          splitId: node.id,
          index: i,
          dir: node.dir,
          rect:
            node.dir === "row"
              ? { x: r.x + offset * r.w, y: r.y, w: 0, h: r.h }
              : { x: r.x, y: r.y + offset * r.h, w: r.w, h: 0 },
          parent: r,
        });
      }
      walk(c, cr);
    });
  };
  walk(root, area);
  return out;
}

function mapSplit(root: LayoutNode, id: string, f: (s: SplitNode) => SplitNode): LayoutNode {
  if (root.kind === "pane") return root;
  if (root.id === id) return f(root);
  return { ...root, children: root.children.map((c) => mapSplit(c, id, f)) };
}

/** Moves the boundary after child `index` by `delta` (fraction of the split). */
export function resize(root: LayoutNode, splitId: string, index: number, delta: number) {
  return mapSplit(root, splitId, (s) => {
    const sizes = [...s.sizes];
    const a = sizes[index];
    const b = sizes[index + 1];
    const d = Math.max(MIN - a, Math.min(b - MIN, delta));
    sizes[index] = a + d;
    sizes[index + 1] = b - d;
    return { ...s, sizes };
  });
}

/** Sets the boundary after child `index` to an absolute fraction of the split. */
export function setBoundary(root: LayoutNode, splitId: string, index: number, at: number) {
  return mapSplit(root, splitId, (s) => {
    const before = s.sizes.slice(0, index).reduce((a, b) => a + b, 0);
    return resize(s, s.id, index, at - (before + s.sizes[index])) as SplitNode;
  });
}

/** Keyboard resize: grows the pane toward `side` by moving the nearest matching boundary. */
export function resizeToward(root: LayoutNode, id: string, side: Side, amount: number): LayoutNode {
  const dir = sideDir(side);
  const path = pathTo(root, id);
  for (let i = path.length - 2; i >= 0; i--) {
    const node = path[i] as SplitNode;
    if (node.dir !== dir) continue;
    const idx = node.children.indexOf(path[i + 1]);
    if (sideAfter(side) && idx < node.children.length - 1) {
      return resize(root, node.id, idx, amount);
    }
    if (!sideAfter(side) && idx > 0) {
      return resize(root, node.id, idx - 1, -amount);
    }
  }
  return root;
}

function pathTo(root: LayoutNode, id: string): LayoutNode[] {
  if (root.kind === "pane") return root.id === id ? [root] : [];
  for (const c of root.children) {
    const p = pathTo(c, id);
    if (p.length) return [root, ...p];
  }
  return [];
}

export function equalize(root: LayoutNode): LayoutNode {
  if (root.kind === "pane") return root;
  const n = root.children.length;
  return { ...root, sizes: root.children.map(() => 1 / n), children: root.children.map(equalize) };
}

export function swap(root: LayoutNode, a: string, b: string): LayoutNode {
  if (root.kind === "pane") {
    if (root.id === a) return pane(b);
    if (root.id === b) return pane(a);
    return root;
  }
  return { ...root, children: root.children.map((c) => swap(c, a, b)) };
}

/** Removes `id` and re-inserts it on `side` of `target`. */
export function move(
  root: LayoutNode,
  id: string,
  target: string,
  side: Side,
  splitId: string,
): LayoutNode {
  if (id === target) return root;
  const without = remove(root, id);
  if (!without) return root;
  return split(without, target, side, id, splitId);
}

/** Nearest pane on `side`, preferring the one that overlaps the most. */
export function neighbor(root: LayoutNode, id: string, side: Side): string | null {
  const all = rects(root);
  const r = all.get(id);
  if (!r) return null;
  const eps = 1e-6;
  let best: { id: string; dist: number; overlap: number } | null = null;
  for (const [other, o] of all) {
    if (other === id) continue;
    let dist: number;
    let overlap: number;
    if (side === "left" || side === "right") {
      dist = side === "left" ? r.x - (o.x + o.w) : o.x - (r.x + r.w);
      overlap = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y);
    } else {
      dist = side === "up" ? r.y - (o.y + o.h) : o.y - (r.y + r.h);
      overlap = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x);
    }
    if (dist < -eps || overlap <= eps) continue;
    if (
      !best ||
      dist < best.dist - eps ||
      (Math.abs(dist - best.dist) <= eps && overlap > best.overlap)
    ) {
      best = { id: other, dist, overlap };
    }
  }
  return best?.id ?? null;
}

export type Preset = "columns" | "rows" | "grid" | "main-stack";

/** Rebuilds a layout for the given panes. `newId` supplies split ids. */
export function preset(ids: string[], kind: Preset, newId: () => string): LayoutNode {
  if (ids.length === 1) return pane(ids[0]);
  const even = (dir: Dir, nodes: LayoutNode[]): LayoutNode =>
    nodes.length === 1
      ? nodes[0]
      : {
          kind: "split",
          id: newId(),
          dir,
          children: nodes,
          sizes: nodes.map(() => 1 / nodes.length),
        };
  switch (kind) {
    case "columns":
      return even("row", ids.map(pane));
    case "rows":
      return even("column", ids.map(pane));
    case "main-stack":
      return {
        kind: "split",
        id: newId(),
        dir: "row",
        children: [pane(ids[0]), even("column", ids.slice(1).map(pane))],
        sizes: [0.6, 0.4],
      };
    case "grid": {
      const cols = Math.ceil(Math.sqrt(ids.length));
      const rows: LayoutNode[] = [];
      for (let i = 0; i < ids.length; i += cols) {
        rows.push(even("row", ids.slice(i, i + cols).map(pane)));
      }
      return even("column", rows);
    }
  }
}
