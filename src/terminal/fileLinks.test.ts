import { expect, test } from "vitest";
import { findPaths } from "./fileLinks";

test("paths", () => {
  const m = findPaths("error at src/main.rs:42:7 and ./lib/a.ts, see ~/x/README.md");
  expect(m.map((x) => [x.path, x.line, x.col])).toEqual([
    ["src/main.rs", 42, 7],
    ["./lib/a.ts", undefined, undefined],
    ["~/x/README.md", undefined, undefined],
  ]);
  expect(findPaths("version 1.2.3 and https://x.com/a.html")).toEqual([]);
  expect(findPaths("Cargo.toml:12").map((x) => x.line)).toEqual([12]);
});
