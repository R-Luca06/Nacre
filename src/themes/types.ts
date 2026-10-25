export const ANSI_NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

export interface Theme {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  cursorText?: string;
  selection: string;
  selectionText?: string;
  /** 16 ANSI colors, normal then bright. */
  ansi: string[];
  /** Chrome accent; defaults to ANSI blue. */
  accent?: string;
}
