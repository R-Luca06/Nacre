/** Subcommands for common tools, for the completion menu. */
const SPECS: Record<string, string[]> = {
  git: "add bisect blame branch checkout cherry-pick clone commit config diff fetch grep init log merge mv pull push rebase reflog remote reset restore revert rm show stash status switch tag worktree".split(
    " ",
  ),
  npm: "audit ci config exec init install link list ls outdated publish rebuild run start test uninstall update version view".split(
    " ",
  ),
  pnpm: "add dlx exec install list outdated remove run start test update".split(" "),
  yarn: "add dlx install remove run start test upgrade".split(" "),
  docker:
    "build compose cp exec images inspect kill logs network ps pull push restart rm rmi run start stop system volume".split(
      " ",
    ),
  cargo:
    "add bench build check clean clippy doc fmt init install new publish remove run test tree update".split(
      " ",
    ),
  kubectl:
    "apply config create delete describe edit exec explain get logs port-forward rollout scale top".split(
      " ",
    ),
  brew: "cleanup doctor info install list outdated search services uninstall update upgrade".split(
    " ",
  ),
  gh: "auth browse issue pr release repo run workflow".split(" "),
};

const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/**
 * Candidates for the word being typed: subcommands, then package.json scripts after `run`.
 * Returns full replacement words.
 */
export function complete(input: string, scripts: string[]): string[] {
  const words = input.split(/\s+/);
  const word = words.at(-1) ?? "";
  const done = words.slice(0, -1);
  if (done.length === 1 && SPECS[done[0]]) return SPECS[done[0]].filter((s) => s.startsWith(word));
  if (done.length === 2 && RUNNERS.has(done[0]) && done[1] === "run")
    return scripts.filter((s) => s.startsWith(word));
  return [];
}
