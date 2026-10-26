import { expect, test } from "vitest";
import { Recorder, parseCast } from "./recording";

test("round trip", () => {
  const r = new Recorder();
  r.push(new TextEncoder().encode("hello "));
  r.push(new Uint8Array([0xc3]));
  r.push(new Uint8Array([0xa9, 0x0a]));
  const cast = parseCast(r.toCast(80, 24, "/bin/zsh"));
  expect(cast.width).toBe(80);
  expect(cast.events.map((e) => e[1]).join("")).toBe("hello é\n");
  expect(() => parseCast('{"version":1}')).toThrow();
});
