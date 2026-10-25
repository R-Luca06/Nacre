import { homeDir as fetchHome } from "@tauri-apps/api/path";

let home = "";

export async function initPaths() {
  home = (await fetchHome().catch(() => "")).replace(/\/$/, "");
}

export const homeDir = () => home;

/** `/Users/me/dev/nacre` → `~/dev/nacre` */
export function tildify(path: string, h = home): string {
  if (h && (path === h || path.startsWith(h + "/"))) return "~" + path.slice(h.length);
  return path;
}

/** Last path segment, `~` for home. */
export function baseName(path: string | undefined, h = home): string {
  if (!path) return "";
  const p = tildify(path.replace(/\/+$/, "") || "/", h);
  if (p === "~" || p === "/") return p;
  return p.slice(p.lastIndexOf("/") + 1);
}

const DANGEROUS = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
  /\bsudo\b/,
  /\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
  /\bmkfs\b|\bdd\s+if=/,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\bchmod\s+-R\s+777\b/,
  /\bgit\s+push\b[^\n]*--force\b/,
];

export const isDangerousPaste = (text: string) => DANGEROUS.some((r) => r.test(text));
