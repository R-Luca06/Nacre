import { expect, test } from "vitest";
import { fuzzyFilter, fuzzyScore } from "./fuzzy";

test("fuzzy", () => {
  expect(fuzzyScore("nt", "New Tab")).not.toBeNull();
  expect(fuzzyScore("xz", "New Tab")).toBeNull();
  const items = ["Split Right", "New Tab", "Next Tab", "Rename Tab"];
  expect(fuzzyFilter(items, "nt", (x) => x).slice(0, 2)).toEqual(["New Tab", "Next Tab"]);
  expect(fuzzyFilter(items, "", (x) => x)).toEqual(items);
});
