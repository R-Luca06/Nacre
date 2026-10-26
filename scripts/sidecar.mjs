// Copies the `nacre` CLI next to the app binary, named with the target triple as Tauri expects.
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";

const profile = process.argv[2] === "release" ? "release" : "debug";
const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  execSync("rustc -vV").toString().match(/host: (\S+)/)[1];
const flags = profile === "release" ? `--release --target ${triple}` : "";
execSync(`cargo build -p nacre-cli ${flags}`, { stdio: "inherit" });
const src = profile === "release" ? `target/${triple}/release/nacre` : "target/debug/nacre";
mkdirSync("src-tauri/binaries", { recursive: true });
copyFileSync(src, `src-tauri/binaries/nacre-${triple}`);
console.log(`sidecar: src-tauri/binaries/nacre-${triple}`);
