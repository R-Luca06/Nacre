export interface SnippetParam {
  name: string;
  default?: string;
}

/** `ssh {{host}} -p {{port:22}}` → host, port (default 22). */
export function snippetParams(template: string): SnippetParam[] {
  const out: SnippetParam[] = [];
  for (const m of template.matchAll(/\{\{\s*([\w-]+)\s*(?::([^}]*))?\}\}/g)) {
    if (!out.some((p) => p.name === m[1])) out.push({ name: m[1], default: m[2]?.trim() });
  }
  return out;
}

export function fillSnippet(template: string, values: Record<string, string>): string {
  return template.replace(
    /\{\{\s*([\w-]+)\s*(?::([^}]*))?\}\}/g,
    (_, name: string, def?: string) =>
      values[name] !== undefined && values[name] !== "" ? values[name] : (def ?? "").trim(),
  );
}
