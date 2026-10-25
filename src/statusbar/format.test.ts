import { expect, test } from "vitest";
import { formatBytes, formatDuration, formatTime, shortenPath } from "./format";

test("shortenPath", () => {
  expect(shortenPath("~/dev")).toBe("~/dev");
  expect(shortenPath("~/Development/nacre/src/app/statusbar", 20)).toBe("~/D/n/s/app/statusbar");
  expect(shortenPath("~/.config/nacre/themes/x", 15)).toBe("~/.c/n/themes/x");
});

test("formatBytes", () => {
  expect(formatBytes(512)).toBe("512B");
  expect(formatBytes(1536)).toBe("1.5K");
  expect(formatBytes(16 * 1024 ** 3)).toBe("16G");
});

test("formatDuration", () => {
  expect(formatDuration(340)).toBe("340ms");
  expect(formatDuration(2500)).toBe("2.5s");
  expect(formatDuration(95_000)).toBe("1m35s");
  expect(formatDuration(3_900_000)).toBe("1h05m");
});

test("formatTime", () => {
  const d = new Date(2026, 0, 1, 14, 5, 9);
  expect(formatTime(d, "24h")).toBe("14:05");
  expect(formatTime(d, "24h-seconds")).toBe("14:05:09");
  expect(formatTime(d, "12h")).toBe("2:05 PM");
});
