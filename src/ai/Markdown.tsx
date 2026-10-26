import { Fragment, type ReactNode } from "react";

/** Inline `code` and **bold**; everything else stays plain text. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(
      tok.startsWith("`") ? (
        <code key={`${key}-${i++}`}>{tok.slice(1, -1)}</code>
      ) : (
        <strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong>
      ),
    );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal Markdown for AI answers: fences, bullets, paragraphs. No HTML is injected. */
export function Markdown({ text, onCode }: { text: string; onCode?: (code: string) => ReactNode }) {
  const parts = text.split(/```[a-z]*\n?/i);
  return (
    <div className="md">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <div key={i} className="md-code">
            <pre>{part.replace(/\n$/, "")}</pre>
            {onCode?.(part.trim())}
          </div>
        ) : (
          <Fragment key={i}>
            {part
              .split(/\n{2,}/)
              .filter((p) => p.trim())
              .map((p, j) => {
                const lines = p.split("\n").filter((l) => l.trim());
                if (lines.every((l) => /^\s*([-*•]|\d+\.)\s/.test(l))) {
                  return (
                    <ul key={j}>
                      {lines.map((l, k) => (
                        <li key={k}>
                          {inline(l.replace(/^\s*([-*•]|\d+\.)\s/, ""), `${i}-${j}-${k}`)}
                        </li>
                      ))}
                    </ul>
                  );
                }
                return <p key={j}>{inline(p, `${i}-${j}`)}</p>;
              })}
          </Fragment>
        ),
      )}
    </div>
  );
}
