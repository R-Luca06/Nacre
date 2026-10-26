import { expect, test } from "vitest";
import { autoProfile, matchDir, matchHost, normalizeProfiles, sshHost } from "./profiles";

test("normalize", () => {
  const errors: string[] = [];
  const p = normalizeProfiles(
    {
      work: { cwd: "~/work", theme: "Nord", font_size: 200, nope: 1, match_dirs: ["~/work"] },
      bad: 3,
    },
    errors,
  );
  expect(p.work.cwd).toBe("~/work");
  expect(p.work.font_size).toBe(0);
  expect(p.work.match_dirs).toEqual(["~/work"]);
  expect(errors).toHaveLength(3);
});

test("dirs", () => {
  expect(matchDir("~/work", "/Users/me/work/api", "/Users/me")).toBe(true);
  expect(matchDir("~/work", "/Users/me/workshop", "/Users/me")).toBe(false);
  expect(matchDir("~/clients/*/prod", "/Users/me/clients/acme/prod/x", "/Users/me")).toBe(true);
  expect(matchDir("/srv/**", "/srv/a/b", "/h")).toBe(true);
});

test("ssh", () => {
  expect(sshHost(["ssh", "-p", "2222", "root@db.prod.example"])).toBe("db.prod.example");
  expect(sshHost(["ssh", "-A", "box"])).toBe("box");
  expect(matchHost("*.prod.*", "db.prod.example")).toBe(true);
  expect(matchHost("*.prod.*", "db.staging.example")).toBe(false);
});

test("auto", () => {
  const profiles = normalizeProfiles(
    { prod: { match_ssh: ["*.prod.*"] }, work: { match_dirs: ["~/work"] } },
    [],
  );
  expect(autoProfile(profiles, { cwd: "/h/work/x", home: "/h" })?.name).toBe("work");
  expect(autoProfile(profiles, { sshHost: "a.prod.b", cwd: "/h/work", home: "/h" })?.name).toBe(
    "prod",
  );
  expect(autoProfile(profiles, { cwd: "/tmp", home: "/h" })).toBeUndefined();
});
