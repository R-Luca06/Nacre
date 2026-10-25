import { describe, expect, test } from "vitest";
import {
  type LayoutNode,
  type SplitNode,
  dividers,
  equalize,
  move,
  neighbor,
  pane,
  paneIds,
  preset,
  rects,
  remove,
  resize,
  resizeToward,
  setBoundary,
  split,
  swap,
} from "./tree";

let n = 0;
const sid = () => `s${++n}`;

describe("split", () => {
  test("pane becomes a split", () => {
    const t = split(pane("a"), "a", "right", "b", "s1") as SplitNode;
    expect(t.dir).toBe("row");
    expect(paneIds(t)).toEqual(["a", "b"]);
    expect(t.sizes).toEqual([0.5, 0.5]);
  });

  test("same direction adds a sibling sharing the target's space", () => {
    let t: LayoutNode = split(pane("a"), "a", "right", "b", "s1");
    t = split(t, "b", "right", "c", "s2") as SplitNode;
    expect(t.kind === "split" && t.children.length).toBe(3);
    expect((t as SplitNode).sizes).toEqual([0.5, 0.25, 0.25]);
  });

  test("other direction nests", () => {
    let t: LayoutNode = split(pane("a"), "a", "right", "b", "s1");
    t = split(t, "a", "down", "c", "s2");
    expect(paneIds(t)).toEqual(["a", "c", "b"]);
    expect((t as SplitNode).children[0].kind).toBe("split");
  });

  test("left/up insert before", () => {
    const t = split(pane("a"), "a", "left", "b", "s1");
    expect(paneIds(t)).toEqual(["b", "a"]);
  });
});

describe("remove", () => {
  test("collapses single-child splits", () => {
    const t = split(pane("a"), "a", "right", "b", "s1");
    expect(remove(t, "b")).toEqual(pane("a"));
    expect(remove(pane("a"), "a")).toBeNull();
  });

  test("renormalizes sizes", () => {
    let t: LayoutNode = split(pane("a"), "a", "right", "b", "s1");
    t = split(t, "b", "right", "c", "s2");
    const r = remove(t, "a") as SplitNode;
    expect(r.sizes[0]).toBeCloseTo(0.5);
    expect(r.sizes[1]).toBeCloseTo(0.5);
  });

  test("merges nested same-direction splits", () => {
    // row[a, column[b, row[c, d]]] - remove b → row[a, c, d]
    let t: LayoutNode = split(pane("a"), "a", "right", "b", "s1");
    t = split(t, "b", "down", "c", "s2");
    t = split(t, "c", "right", "d", "s3");
    const r = remove(t, "b") as SplitNode;
    expect(r.dir).toBe("row");
    expect(r.children.map((c) => c.kind)).toEqual(["pane", "pane", "pane"]);
    expect(r.sizes.reduce((a, b) => a + b)).toBeCloseTo(1);
  });
});

describe("geometry", () => {
  const t = split(split(pane("a"), "a", "right", "b", "s1"), "b", "down", "c", "s2");

  test("rects", () => {
    const r = rects(t);
    expect(r.get("a")).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(r.get("c")).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  test("dividers", () => {
    const d = dividers(t);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ splitId: "s1", dir: "row", rect: { x: 0.5 } });
    expect(d[1]).toMatchObject({ splitId: "s2", dir: "column", rect: { y: 0.5, x: 0.5 } });
  });

  test("neighbor", () => {
    expect(neighbor(t, "a", "right")).toBe("b");
    expect(neighbor(t, "c", "left")).toBe("a");
    expect(neighbor(t, "b", "down")).toBe("c");
    expect(neighbor(t, "c", "up")).toBe("b");
    expect(neighbor(t, "a", "left")).toBeNull();
  });
});

describe("resize", () => {
  const t = split(pane("a"), "a", "right", "b", "s1");

  test("clamps to a minimum", () => {
    const r = resize(t, "s1", 0, 0.9) as SplitNode;
    expect(r.sizes[1]).toBeCloseTo(0.05);
  });

  test("absolute boundary", () => {
    const r = setBoundary(t, "s1", 0, 0.3) as SplitNode;
    expect(r.sizes[0]).toBeCloseTo(0.3);
  });

  test("keyboard resize finds the right boundary", () => {
    const r = resizeToward(t, "b", "left", 0.1) as SplitNode;
    expect(r.sizes[0]).toBeCloseTo(0.4);
    const r2 = resizeToward(t, "a", "right", 0.1) as SplitNode;
    expect(r2.sizes[0]).toBeCloseTo(0.6);
    expect(resizeToward(t, "a", "up", 0.1)).toBe(t);
  });

  test("equalize", () => {
    const r = equalize(resize(t, "s1", 0, 0.2)) as SplitNode;
    expect(r.sizes).toEqual([0.5, 0.5]);
  });
});

describe("rearrange", () => {
  test("swap", () => {
    const t = split(pane("a"), "a", "right", "b", "s1");
    expect(paneIds(swap(t, "a", "b"))).toEqual(["b", "a"]);
  });

  test("move", () => {
    let t: LayoutNode = split(pane("a"), "a", "right", "b", "s1");
    t = split(t, "b", "right", "c", "s2");
    const m = move(t, "a", "c", "down", "s3");
    expect(paneIds(m)).toEqual(["b", "c", "a"]);
  });

  test("presets", () => {
    expect(paneIds(preset(["a", "b", "c", "d"], "grid", sid))).toEqual(["a", "b", "c", "d"]);
    const g = preset(["a", "b", "c", "d"], "grid", sid) as SplitNode;
    expect(g.dir).toBe("column");
    expect(g.children).toHaveLength(2);
    const m = preset(["a", "b", "c"], "main-stack", sid) as SplitNode;
    expect(m.sizes).toEqual([0.6, 0.4]);
    expect(preset(["a"], "columns", sid)).toEqual(pane("a"));
  });
});
