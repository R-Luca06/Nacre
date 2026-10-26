import { convertFileSrc } from "@tauri-apps/api/core";
import { Effect, EffectState, getCurrentWindow } from "@tauri-apps/api/window";
import type { Config } from "../config/schema";
import { parseHex } from "../themes/color";
import type { Theme } from "../themes/types";
import { homeDir } from "./paths";

/** True when something must show through the terminal background. */
export function seeThrough(c: Config): boolean {
  const w = c.window;
  return w.opacity < 1 || w.blur || !!w.background_image || !!w.background_gradient;
}

let lastBlur: boolean | null = null;

export function applyAppearance(c: Config, theme: Theme) {
  const root = document.documentElement;
  const w = c.window;
  const see = seeThrough(c);
  root.classList.toggle("see-through", see);
  const rgb = parseHex(theme.background) ?? [14, 15, 18];
  root.style.setProperty("--window-bg", `rgba(${rgb.join(",")}, ${see ? w.opacity : 1})`);
  const img = w.background_image.replace(/^~(?=\/)/, homeDir());
  root.style.setProperty(
    "--bg-image",
    img ? `url("${convertFileSrc(img)}")` : w.background_gradient || "none",
  );
  root.style.setProperty("--bg-image-opacity", String(img ? w.background_image_opacity : 1));
  for (const e of ["crt", "scanlines", "glow"])
    root.classList.toggle(`effect-${e}`, w.effect === e);
  if (lastBlur !== w.blur) {
    lastBlur = w.blur;
    const win = getCurrentWindow();
    void (
      w.blur
        ? win.setEffects({ effects: [Effect.UnderWindowBackground], state: EffectState.Active })
        : win.clearEffects()
    ).catch(() => {});
  }
}
