const CANDIDATES = [
  "JetBrains Mono",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Fira Code",
  "Fira Mono",
  "Cascadia Code",
  "Cascadia Mono",
  "Iosevka",
  "Iosevka Term",
  "Hack",
  "Source Code Pro",
  "IBM Plex Mono",
  "Berkeley Mono",
  "Ubuntu Mono",
  "Roboto Mono",
  "Victor Mono",
  "Geist Mono",
  "Commit Mono",
  "Monaspace Neon",
  "Monaspace Argon",
  "Inconsolata",
  "Courier New",
  "MesloLGS NF",
  "Hasklig",
  "Operator Mono",
];

/** Installed monospace fonts among common ones (width test against two fallbacks). */
export function availableMonoFonts(): string[] {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return CANDIDATES;
  const sample = "mmmmmmmmmmlliiWW@#0O";
  const width = (font: string) => {
    ctx.font = `20px ${font}`;
    return ctx.measureText(sample).width;
  };
  const baseMono = width("monospace");
  const baseSerif = width("serif");
  return CANDIDATES.filter((f) => {
    const q = `"${f}"`;
    return width(`${q}, monospace`) !== baseMono || width(`${q}, serif`) !== baseSerif;
  });
}
