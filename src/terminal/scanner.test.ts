import { expect, test } from "vitest";
import { findSecrets, resolveColor } from "./scanner";

test("secrets", () => {
  const key = "sk-ant-api03-" + "a".repeat(40);
  expect(findSecrets(`export KEY=${key} done`)).toEqual([[11, 11 + key.length]]);
  expect(findSecrets("AKIAIOSFODNN7EXAMPLE and ghp_" + "x".repeat(36))).toHaveLength(2);
  expect(findSecrets("nothing secret here, sk-short")).toEqual([]);
});
import { normalizeConfig } from "../config/schema";

test("colors", () => {
  const pal = Array.from({ length: 16 }, (_, i) => `#0000${i.toString(16).padStart(2, "0")}`);
  expect(resolveColor("red", pal)).toBe("#000001");
  expect(resolveColor("brightWhite", pal)).toBe("#00000f");
  expect(resolveColor("#abcdef", pal)).toBe("#abcdef");
  expect(resolveColor("nope", pal)).toBeUndefined();
});

test("rules validation", () => {
  const { config, errors } = normalizeConfig({
    highlight: [{ regex: "ERROR", color: "red" }, { regex: "(" }, { regex: "x" }],
    triggers: [
      { regex: "done", action: "notify" },
      { regex: "y", action: "explode" },
      { regex: "z", action: "command" },
    ],
  });
  expect(config.highlight).toHaveLength(1);
  expect(config.triggers).toHaveLength(1);
  expect(errors).toHaveLength(4);
});
