import { describe, expect, test } from "vitest";
import { parse } from "smol-toml";
import { defaults, normalizeConfig } from "./schema";
import { renderTemplate } from "./template";

describe("normalizeConfig", () => {
  test("empty input gives defaults", () => {
    expect(normalizeConfig({})).toEqual({ config: defaults, errors: [] });
  });

  test("keeps valid values, reverts invalid ones with one error each", () => {
    const { config, errors } = normalizeConfig({
      font: { size: 15, line_height: "big" },
      cursor: { style: "beam" },
      terminal: { scrollback: 2.5 },
      nope: 1,
    });
    expect(config.font.size).toBe(15);
    expect(config.font.line_height).toBe(defaults.font.line_height);
    expect(config.cursor.style).toBe("block");
    expect(config.terminal.scrollback).toBe(10000);
    expect(errors).toHaveLength(4);
    expect(errors.join("\n")).toMatch(/cursor.style: use one of block, bar, underline/);
  });

  test("free-form maps", () => {
    const { config, errors } = normalizeConfig({
      shell: { env: { A: "1", B: 2 } },
      keys: { "tab.new": ["cmd+t"], x: 3 },
    });
    expect(config.shell.env).toEqual({ A: "1" });
    expect(config.keys).toEqual({ "tab.new": ["cmd+t"] });
    expect(errors).toHaveLength(2);
  });

  test("custom segments", () => {
    const { config, errors } = normalizeConfig({
      statusbar: {
        custom: [
          { name: "w", command: "echo hi", interval: 60, danger: "(" },
          { command: "x" },
          "nope",
        ],
      },
    });
    expect(config.statusbar.custom).toEqual([
      {
        name: "w",
        command: "echo hi",
        interval: 60,
        warn: undefined,
        danger: undefined,
        click: undefined,
      },
    ]);
    expect(errors).toHaveLength(3);
  });

  test("ranges", () => {
    expect(normalizeConfig({ font: { size: 200 } }).errors[0]).toMatch(/between 6 and 72/);
  });
});

describe("template", () => {
  test("uncommented template equals the defaults", () => {
    const text = renderTemplate({ "tab.new": ["cmd+t"], "tab.next": ["shift+cmd+]", "ctrl+tab"] });
    const uncommented = text
      .split("\n")
      .map((l) => (/^# [\w"]/.test(l) && l.includes(" = ") ? l.slice(2) : l))
      .join("\n");
    const parsed = parse(uncommented);
    const { config, errors } = normalizeConfig(parsed);
    expect(errors).toEqual([]);
    expect({ ...config, keys: {} }).toEqual(defaults);
    expect(config.keys).toEqual({ "tab.new": "cmd+t", "tab.next": ["shift+cmd+]", "ctrl+tab"] });
  });
});
