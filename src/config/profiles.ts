export interface Profile {
  name: string;
  shell: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  command: string;
  theme: string;
  font_family: string;
  /** 0 keeps the global size. */
  font_size: number;
  /** Panes whose directory matches take this profile's look (globs, `~` allowed). */
  match_dirs: string[];
  /** Same for `ssh` sessions to matching hosts. */
  match_ssh: string[];
}

const EMPTY: Omit<Profile, "name"> = {
  shell: "",
  args: [],
  cwd: "",
  env: {},
  command: "",
  theme: "",
  font_family: "",
  font_size: 0,
  match_dirs: [],
  match_ssh: [],
};

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

export function normalizeProfiles(raw: unknown, errors: string[]): Record<string, Profile> {
  const out: Record<string, Profile> = {};
  if (raw === undefined) return out;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("profiles: expected tables like [profiles.work]");
    return out;
  }
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`profiles.${name}: expected a table`);
      continue;
    }
    const v = value as Record<string, unknown>;
    const p: Profile = { name, ...EMPTY, env: {} };
    for (const [k, x] of Object.entries(v)) {
      const path = `profiles.${name}.${k}`;
      if (!(k in EMPTY)) {
        errors.push(`${path}: unknown setting`);
        continue;
      }
      const def = EMPTY[k as keyof typeof EMPTY];
      if (Array.isArray(def)) {
        if (isStrings(x)) (p as unknown as Record<string, unknown>)[k] = x;
        else errors.push(`${path}: expected a list of strings`);
      } else if (typeof def === "object") {
        if (
          x &&
          typeof x === "object" &&
          !Array.isArray(x) &&
          Object.values(x).every((e) => typeof e === "string")
        ) {
          p.env = x as Record<string, string>;
        } else errors.push(`${path}: expected a table of strings`);
      } else if (typeof def === typeof x) {
        (p as unknown as Record<string, unknown>)[k] = x;
      } else {
        errors.push(`${path}: expected ${typeof def}`);
      }
    }
    if (p.font_size && (p.font_size < 6 || p.font_size > 72)) {
      errors.push(`profiles.${name}.font_size: must be between 6 and 72`);
      p.font_size = 0;
    }
    out[name] = p;
  }
  return out;
}

function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** A plain path matches itself and everything below it; globs match exactly. */
export function matchDir(pattern: string, cwd: string, home: string): boolean {
  const p = pattern.replace(/^~(?=\/|$)/, home).replace(/\/+$/, "");
  if (!/[*?]/.test(p)) return cwd === p || cwd.startsWith(p + "/");
  return globToRegex(p).test(cwd) || globToRegex(p + "/**").test(cwd);
}

export function matchHost(pattern: string, host: string): boolean {
  return globToRegex(pattern.replace(/\*\*/g, "*")).test(host);
}

/** Host of an `ssh` command line: the first argument that is not an option. */
export function sshHost(args: string[]): string | undefined {
  const withValue = new Set("BbcDEeFIiJLlmOoPpQRSWw".split("").map((c) => `-${c}`));
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (withValue.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    return a.includes("@") ? a.slice(a.indexOf("@") + 1) : a;
  }
  return undefined;
}

export function autoProfile(
  profiles: Record<string, Profile>,
  ctx: { cwd?: string; sshHost?: string; home: string },
): Profile | undefined {
  const list = Object.values(profiles);
  if (ctx.sshHost) {
    const hit = list.find((p) => p.match_ssh.some((m) => matchHost(m, ctx.sshHost!)));
    if (hit) return hit;
  }
  if (ctx.cwd) return list.find((p) => p.match_dirs.some((m) => matchDir(m, ctx.cwd!, ctx.home)));
  return undefined;
}
