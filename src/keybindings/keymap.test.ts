import { describe, expect, test } from "vitest";
import { eventCombos, formatCombo, parseCombo, type KeyLike } from "./combo";
import { Keymap, findConflicts, mergeBindings } from "./keymap";

const ev = (key: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("parseCombo", () => {
  test("normalizes modifier order and aliases", () => {
    expect(parseCombo("Shift+Cmd+T")).toBe("shift+cmd+t");
    expect(parseCombo("command+option+Left")).toBe("alt+cmd+arrowleft");
    expect(parseCombo("ctrl+a d")).toBe("ctrl+a d");
    expect(parseCombo("cmd++")).toBe("cmd++");
  });
  test("rejects invalid input", () => {
    expect(parseCombo("cmd+")).toBeNull();
    expect(parseCombo("cmd+a+b")).toBeNull();
    expect(parseCombo("")).toBeNull();
  });
});

describe("eventCombos", () => {
  test("uses the produced key then the physical key", () => {
    expect(eventCombos(ev("{", "BracketLeft", { metaKey: true, shiftKey: true }))).toEqual([
      "shift+cmd+{",
      "shift+cmd+[",
    ]);
    expect(eventCombos(ev("T", "KeyT", { metaKey: true, shiftKey: true }))).toEqual([
      "shift+cmd+t",
    ]);
  });
  test("AZERTY digits and Option characters still match", () => {
    expect(eventCombos(ev("&", "Digit1", { metaKey: true }))).toContain("cmd+1");
    expect(eventCombos(ev("ƒ", "KeyF", { altKey: true }))).toContain("alt+f");
  });
  test("ignores bare modifiers", () => {
    expect(eventCombos(ev("Shift", "ShiftLeft", { shiftKey: true }))).toEqual([]);
  });
});

describe("Keymap", () => {
  const km = () =>
    new Keymap({
      "tab.new": ["cmd+t"],
      "tab.prev": ["shift+cmd+["],
      "pane.splitRight": ["ctrl+a d"],
    });

  test("matches single combos", () => {
    expect(km().handle(ev("t", "KeyT", { metaKey: true }))).toEqual({
      kind: "action",
      action: "tab.new",
    });
    expect(km().handle(ev("{", "BracketLeft", { metaKey: true, shiftKey: true }))).toEqual({
      kind: "action",
      action: "tab.prev",
    });
    expect(km().handle(ev("x", "KeyX"))).toEqual({ kind: "none" });
  });

  test("chords", () => {
    const k = km();
    expect(k.handle(ev("a", "KeyA", { ctrlKey: true }), 0).kind).toBe("pending");
    expect(k.handle(ev("Control", "ControlLeft", { ctrlKey: true }), 10).kind).toBe("pending");
    expect(k.handle(ev("d", "KeyD"), 20)).toEqual({ kind: "action", action: "pane.splitRight" });
    expect(k.handle(ev("a", "KeyA", { ctrlKey: true }), 30).kind).toBe("pending");
    expect(k.handle(ev("z", "KeyZ"), 40).kind).toBe("cancelled");
  });

  test("chords time out", () => {
    const k = km();
    k.handle(ev("a", "KeyA", { ctrlKey: true }), 0);
    expect(k.handle(ev("d", "KeyD"), 5000).kind).toBe("none");
  });
});

describe("bindings", () => {
  test("overrides replace defaults and report errors", () => {
    const { bindings, errors } = mergeBindings(
      { "tab.new": ["cmd+t"], "tab.close": ["cmd+w"] },
      { "tab.new": ["Cmd+Shift+N", "nope+"], "tab.close": "" },
    );
    expect(bindings["tab.new"]).toEqual(["shift+cmd+n"]);
    expect(bindings["tab.close"]).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  test("conflicts", () => {
    const c = findConflicts({ a: ["cmd+t"], b: ["cmd+t"], c: ["ctrl+a"], d: ["ctrl+a d"] });
    expect(c).toContainEqual({ combo: "cmd+t", actions: ["a", "b"] });
    expect(c).toContainEqual({ combo: "ctrl+a", actions: ["c", "d"] });
  });

  test("format", () => {
    expect(formatCombo("shift+cmd+t")).toBe("⇧⌘T");
    expect(formatCombo("ctrl+a d")).toBe("⌃A D");
    expect(formatCombo("cmd++")).toBe("⌘+");
  });
});
