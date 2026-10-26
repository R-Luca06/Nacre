import { expect, test } from "vitest";
import { complete } from "./specs";

test("complete", () => {
  expect(complete("git sta", [])).toEqual(["stash", "status"]);
  expect(complete("npm run d", ["dev", "build", "docs"])).toEqual(["dev", "docs"]);
  expect(complete("git", [])).toEqual([]);
  expect(complete("ls -la ", [])).toEqual([]);
});
