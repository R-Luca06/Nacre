import { createElement } from "react";
import {
  Activity,
  Asterisk,
  BookOpen,
  Container,
  GitBranch,
  Hammer,
  Hexagon,
  Package,
  PenLine,
  Server,
  Ship,
  SquareTerminal,
  Braces,
  type LucideIcon,
} from "lucide-react";
import type { ProcInfo } from "../ipc/pty";

const ICONS: [RegExp, LucideIcon][] = [
  [/^claude$/, Asterisk],
  [/^(n?vim?|nano|emacs|hx|helix|micro|kak)$/, PenLine],
  [/^(git|lazygit|tig|gitui|gh)$/, GitBranch],
  [/^(docker|docker-compose|podman|colima)$/, Container],
  [/^(kubectl|k9s|helm|minikube)$/, Ship],
  [/^(node|npm|npx|pnpm|yarn|bun|deno|vite|next|tsx|ts-node)$/, Hexagon],
  [/^(python\d?(\.\d+)?|ipython|pip\d?|uv|poetry|jupyter)$/, Braces],
  [/^(cargo|rustc|rustup|go|brew|apt|gem|bundle)$/, Package],
  [/^(make|cmake|ninja|gradle|mvn|xcodebuild|swift)$/, Hammer],
  [/^(ssh|mosh|et|telnet|sftp)$/, Server],
  [/^(top|htop|btop|glances|bottom|btm)$/, Activity],
  [/^(less|more|man|bat)$/, BookOpen],
];

export function iconFor(name: string): LucideIcon {
  return ICONS.find(([re]) => re.test(name))?.[1] ?? SquareTerminal;
}

/** Nothing for an idle shell; a thin icon for known programs. */
export function ProcessIcon({
  proc,
  size = 12,
  className,
}: {
  proc?: ProcInfo;
  size?: number;
  className?: string;
}) {
  if (!proc || proc.isShell) return null;
  return createElement(iconFor(proc.name), {
    size,
    strokeWidth: 1.5,
    className: `proc-icon${className ? ` ${className}` : ""}`,
  });
}
