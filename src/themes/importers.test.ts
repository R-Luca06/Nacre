// @vitest-environment jsdom
import { expect, test } from "vitest";
import { importTheme } from "./importers";

const comp = (r: number, g: number, b: number) =>
  `<dict><key>Blue Component</key><real>${b}</real><key>Green Component</key><real>${g}</real><key>Red Component</key><real>${r}</real></dict>`;

test("iTerm2", () => {
  let body = "";
  for (let i = 0; i < 16; i++) body += `<key>Ansi ${i} Color</key>${comp(i / 15, 0, 0)}`;
  body += `<key>Background Color</key>${comp(0, 0, 0)}<key>Foreground Color</key>${comp(1, 1, 1)}`;
  const t = importTheme(
    "my-theme.itermcolors",
    `<?xml version="1.0"?><plist><dict>${body}</dict></plist>`,
  );
  expect(t.name).toBe("My Theme");
  expect(t.background).toBe("#000000");
  expect(t.foreground).toBe("#ffffff");
  expect(t.ansi[15]).toBe("#ff0000");
});

test("Base16", () => {
  const yaml = `scheme: "Ocean"\nbase00: "2b303b"\nbase01: "343d46"\nbase02: "4f5b66"\nbase03: "65737e"\nbase04: "a7adba"\nbase05: "c0c5ce"\nbase06: "dfe1e8"\nbase07: "eff1f5"\nbase08: "bf616a"\nbase09: "d08770"\nbase0A: "ebcb8b"\nbase0B: "a3be8c"\nbase0C: "96b5b4"\nbase0D: "8fa1b3"\nbase0E: "b48ead"\nbase0F: "ab7967"\n`;
  const t = importTheme("ocean.yaml", yaml);
  expect(t.name).toBe("Ocean");
  expect(t.ansi[1]).toBe("#bf616a");
  expect(t.ansi[15]).toBe("#eff1f5");
});

test("Windows Terminal", () => {
  const j = {
    name: "Campbell",
    background: "#0C0C0C",
    foreground: "#CCCCCC",
    black: "#0C0C0C",
    red: "#C50F1F",
    green: "#13A10E",
    yellow: "#C19C00",
    blue: "#0037DA",
    purple: "#881798",
    cyan: "#3A96DD",
    white: "#CCCCCC",
    brightBlack: "#767676",
    brightRed: "#E74856",
    brightGreen: "#16C60C",
    brightYellow: "#F9F1A5",
    brightBlue: "#3B78FF",
    brightPurple: "#B4009E",
    brightCyan: "#61D6D6",
    brightWhite: "#F2F2F2",
  };
  const t = importTheme("campbell.json", JSON.stringify(j));
  expect(t.name).toBe("Campbell");
  expect(t.ansi[5]).toBe("#881798");
  expect(t.ansi[13]).toBe("#b4009e");
});

test("Ghostty", () => {
  let text = "background = 1d1f21\nforeground = c5c8c6\ncursor-color = c5c8c6\n";
  for (let i = 0; i < 16; i++) text += `palette = ${i}=#${String(i).padStart(2, "0")}0000\n`;
  const t = importTheme("tomorrow", text);
  expect(t.background).toBe("#1d1f21");
  expect(t.ansi[12]).toBe("#120000");
});

test("Alacritty", () => {
  const text = `[colors.primary]\nbackground = "#282828"\nforeground = "#ebdbb2"\n[colors.normal]\nblack = "#282828"\nred = "#cc241d"\ngreen = "#98971a"\nyellow = "#d79921"\nblue = "#458588"\nmagenta = "#b16286"\ncyan = "#689d6a"\nwhite = "#a89984"\n`;
  const t = importTheme("gruvbox.toml", text);
  expect(t.ansi[1]).toBe("#cc241d");
  expect(t.ansi[9]).toBe("#cc241d");
});

test("errors", () => {
  expect(() => importTheme("x.txt", "hello")).toThrow(/Unknown format/);
  expect(() => importTheme("x.json", "{}")).toThrow(/Not enough colors/);
});
