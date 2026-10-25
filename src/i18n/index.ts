import { fr } from "./fr";

export type Language = "en" | "fr";

let current: Language = detect();

function detect(): Language {
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return nav.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function setLanguage(pref: "auto" | Language) {
  current = pref === "auto" ? detect() : pref;
}

export function language(): Language {
  return current;
}

/** English source text is the key; `{name}` placeholders are filled from `vars`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const s = (current === "fr" && fr[text]) || text;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
