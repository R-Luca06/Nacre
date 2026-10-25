import { expect, test } from "vitest";
import { parse } from "smol-toml";
import { builtinThemes } from "./builtin";
import { themeFromRaw, themeToToml } from "./themeFile";

test("round trip", () => {
  for (const t of builtinThemes) {
    const back = themeFromRaw(parse(themeToToml(t)), "x.toml");
    expect(back.error).toBeUndefined();
    expect({ ...back.theme, cursorText: t.cursorText, selectionText: t.selectionText }).toEqual(t);
  }
});

test("errors", () => {
  expect(themeFromRaw({ background: "#000" }, "a.toml").error).toMatch(/foreground/);
  expect(
    themeFromRaw({ background: "#000", foreground: "#fff", palette: [] }, "a.toml").error,
  ).toMatch(/16 hex colors/);
});

test("builtins are well formed", () => {
  const names = new Set<string>();
  for (const t of builtinThemes) {
    expect(t.ansi).toHaveLength(16);
    expect(names.has(t.name)).toBe(false);
    names.add(t.name);
  }
});
