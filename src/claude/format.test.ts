import { expect, test } from "vitest";
import { contextLevel, formatCost, formatTokens } from "./format";

test("format", () => {
  expect(formatTokens(124_400)).toBe("124k");
  expect(formatTokens(1_000_000)).toBe("1M");
  expect(formatTokens(1_250_000)).toBe("1.3M");
  expect(formatTokens(950)).toBe("950");
  expect(formatCost(1.234)).toBe("$1.23");
  expect(formatCost(12.34, false)).toBe("~$12.3");
  expect(contextLevel(85, 60, 80)).toBe("danger");
  expect(contextLevel(65, 60, 80)).toBe("warn");
  expect(contextLevel(10, 60, 80)).toBe("normal");
});
