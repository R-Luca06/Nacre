import { expect, test } from "vitest";
import { parse } from "smol-toml";
import { resolveCwd, tabSpecFrom, workspaceFromRaw, workspaceToToml } from "./workspaces";

const TOML = `
name = "Project X"
cwd = "~/dev/x"

[[tab]]
title = "dev"
layout = "columns"
panes = [ { command = "npm run dev" }, { command = "npm test", cwd = "api" } ]

[[tab]]
title = "shell"

[[tab]]
split = { dir = "row", sizes = [0.7, 0.3], children = [ { command = "claude" }, { dir = "column", children = [ {}, {} ] } ] }
`;

test("parse", () => {
  const { workspace, errors } = workspaceFromRaw(parse(TOML), "x.toml");
  expect(errors).toEqual([]);
  expect(workspace!.name).toBe("Project X");
  expect(workspace!.tabs).toHaveLength(3);
  expect(workspace!.tabs[0].panes).toHaveLength(2);
  expect(workspace!.tabs[1].panes).toEqual([{ command: undefined }]);
  expect(workspace!.tabs[2].split!.children).toHaveLength(2);
});

test("errors", () => {
  expect(workspaceFromRaw({ name: "x" }, "x.toml").errors[0]).toMatch(/\[\[tab\]\]/);
  const r = workspaceFromRaw({ tab: [{ layout: "zigzag" }] }, "x.toml");
  expect(r.errors[0]).toMatch(/layout/);
});

test("cwd", () => {
  expect(resolveCwd("~/dev/x", "api", "/h")).toBe("/h/dev/x/api");
  expect(resolveCwd("~/dev/x", "/tmp", "/h")).toBe("/tmp");
  expect(resolveCwd(undefined, undefined, "/h")).toBeUndefined();
});

test("save and reload", () => {
  const tab = {
    title: "t",
    root: {
      kind: "split" as const,
      id: "s",
      dir: "row" as const,
      sizes: [0.5, 0.5],
      children: [
        { kind: "pane" as const, id: "a" },
        { kind: "pane" as const, id: "b" },
      ],
    },
  };
  const cwds: Record<string, string> = { a: "/h/x", b: "/h/x/api" };
  const spec = tabSpecFrom(tab, (id) => cwds[id], "/h/x");
  const text = workspaceToToml({ name: "Saved", cwd: "/h/x", tabs: [spec] });
  const back = workspaceFromRaw(parse(text), "s.toml");
  expect(back.errors).toEqual([]);
  expect(back.workspace!.tabs[0].split!.children[1]).toEqual({ cwd: "api" });
});
