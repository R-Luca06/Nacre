import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./actions", () => ({ actionById: new Map() }));
vi.mock("../keybindings/runtime", () => ({}));

test("accelerators", async () => {
  const { toAccelerator } = await import("./menu");
  expect(toAccelerator("shift+cmd+t")).toBe("Shift+Cmd+T");
  expect(toAccelerator("alt+cmd+arrowleft")).toBe("Alt+Cmd+ArrowLeft");
  expect(toAccelerator("shift+cmd+[")).toBe("Shift+Cmd+[");
  expect(toAccelerator("ctrl+a d")).toBeUndefined();
  expect(toAccelerator("cmd++")).toBeUndefined();
  expect(toAccelerator("cmd+=")).toBe("Cmd+=");
});
