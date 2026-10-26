import { expect, test } from "vitest";
import { fillSnippet, snippetParams } from "./snippets";

test("snippets", () => {
  const tpl = "ssh {{host}} -p {{port:22}} && echo {{host}}";
  expect(snippetParams(tpl)).toEqual([
    { name: "host", default: undefined },
    { name: "port", default: "22" },
  ]);
  expect(fillSnippet(tpl, { host: "box" })).toBe("ssh box -p 22 && echo box");
  expect(fillSnippet("ls", {})).toBe("ls");
});
