import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ Channel: class {}, invoke: vi.fn() }));

test("extractCommand", async () => {
  const { extractCommand } = await import("./client");
  expect(extractCommand("ls -la")).toBe("ls -la");
  expect(extractCommand("```sh\n$ git status\n```")).toBe("git status");
  expect(extractCommand("Run this:\n```bash\nnpm i\n```\nthen go")).toBe("npm i");
  expect(extractCommand("`pwd`")).toBe("pwd");
  expect(extractCommand("Voici la commande :\n\ncd ~/app && ./run.command")).toBe(
    "cd ~/app && ./run.command",
  );
});
