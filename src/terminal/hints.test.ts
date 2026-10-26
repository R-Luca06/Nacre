import { expect, test } from "vitest";
import { findHints, labels } from "./hints";

test("labels are prefix-free", () => {
  for (const n of [3, 26, 27, 60, 200]) {
    const l = labels(n);
    expect(l).toHaveLength(n);
    expect(new Set(l).size).toBe(n);
    for (const a of l) for (const b of l) if (a !== b) expect(b.startsWith(a)).toBe(false);
  }
});

test("finds kinds", () => {
  const h = findHints([
    "see https://example.com/a?b=1. and 10.0.0.1:8080",
    "commit 3f2a9bc fixed ./src/main.rs:42 for me@x.org",
  ]);
  expect(h.map((x) => [x.kind, x.text])).toEqual([
    ["url", "https://example.com/a?b=1"],
    ["ip", "10.0.0.1:8080"],
    ["hash", "3f2a9bc"],
    ["path", "./src/main.rs:42"],
    ["email", "me@x.org"],
  ]);
  expect(h[0].label).toBe("a");
});
