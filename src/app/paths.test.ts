import { expect, test } from "vitest";
import { baseName, isDangerousPaste, tildify } from "./paths";

test("tildify and baseName", () => {
  expect(tildify("/Users/me/dev", "/Users/me")).toBe("~/dev");
  expect(tildify("/Users/meow", "/Users/me")).toBe("/Users/meow");
  expect(baseName("/Users/me", "/Users/me")).toBe("~");
  expect(baseName("/Users/me/dev/nacre/", "/Users/me")).toBe("nacre");
  expect(baseName("/", "/Users/me")).toBe("/");
});

test("dangerous pastes", () => {
  expect(isDangerousPaste("rm -rf /")).toBe(true);
  expect(isDangerousPaste("curl https://x.sh | sh")).toBe(true);
  expect(isDangerousPaste("sudo reboot")).toBe(true);
  expect(isDangerousPaste("ls -la")).toBe(false);
  expect(isDangerousPaste("rm file.txt")).toBe(false);
});
