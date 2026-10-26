import { useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { allThemes, useConfig } from "../store/config";
import { saveTheme } from "../ipc/config";
import { useWorkspace } from "../store/workspace";
import { importTheme } from "../themes/importers";
import { themeToToml } from "../themes/themeFile";
import { ANSI_NAMES, type Theme } from "../themes/types";
import { t } from "../i18n";
import { Select, setValue } from "./fields";

function Card({
  theme,
  selected,
  onClick,
}: {
  theme: Theme;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`theme-card${selected ? " on" : ""}`} onClick={onClick} title={theme.name}>
      <span
        className="theme-sample"
        style={{ background: theme.background, color: theme.foreground }}
      >
        <span>Aa</span>
        <span className="theme-dots">
          {theme.ansi.slice(1, 7).map((c, i) => (
            <i key={i} style={{ background: c }} />
          ))}
        </span>
      </span>
      <span className="theme-name">{theme.name}</span>
    </button>
  );
}

/** A few lines of fake shell output in the edited colors. */
function Preview({ theme }: { theme: Theme }) {
  const a = theme.ansi;
  return (
    <pre
      className="theme-preview"
      style={{ background: theme.background, color: theme.foreground }}
    >
      <span style={{ color: a[2] }}>~/nacre</span> <span style={{ color: a[4] }}>main</span> % ls -G
      {"\n"}
      <span style={{ color: a[4] }}>src</span> <span style={{ color: a[4] }}>docs</span> README.md
      {"  "}
      <span style={{ color: a[2] }}>build.sh</span>
      {"\n"}
      <span style={{ color: a[1] }}>error</span>: <span style={{ color: a[3] }}>warning</span> ·{" "}
      <span style={{ color: a[5] }}>magenta</span> · <span style={{ color: a[6] }}>cyan</span> ·{" "}
      <span style={{ color: a[8] }}>comment</span>
      {"\n"}
      <span style={{ background: theme.selection, color: theme.selectionText }}>
        selected text
      </span>{" "}
      <span style={{ background: theme.cursor, color: theme.cursorText ?? theme.background }}>
        {" "}
      </span>
    </pre>
  );
}

function Swatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="swatch" title={label}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <span>{label}</span>
    </label>
  );
}

function Editor({ initial, onDone }: { initial: Theme; onDone: () => void }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const set = (patch: Partial<Theme>) => setTheme((x) => ({ ...x, ...patch }));
  const setAnsi = (i: number, c: string) =>
    setTheme((x) => ({ ...x, ansi: x.ansi.map((v, j) => (j === i ? c : v)) }));
  const save = async () => {
    try {
      await saveTheme(theme.name.toLowerCase(), themeToToml(theme));
      const mode = useConfig.getState().config.theme.mode;
      const dark = mode === "dark" || (mode === "system" && useConfig.getState().systemDark);
      await setValue(["theme", dark ? "dark" : "light"], theme.name);
      onDone();
    } catch (e) {
      useWorkspace.getState().showToast(String(e), "warn");
    }
  };
  return (
    <div className="theme-editor">
      <input
        className="text theme-title"
        value={theme.name}
        spellCheck={false}
        onChange={(e) => set({ name: e.target.value })}
      />
      <Preview theme={theme} />
      <div className="swatches">
        <Swatch
          label={t("Background")}
          value={theme.background}
          onChange={(v) => set({ background: v })}
        />
        <Swatch
          label={t("Text")}
          value={theme.foreground}
          onChange={(v) => set({ foreground: v })}
        />
        <Swatch label={t("Cursor")} value={theme.cursor} onChange={(v) => set({ cursor: v })} />
        <Swatch
          label={t("Selection")}
          value={theme.selection}
          onChange={(v) => set({ selection: v })}
        />
        <Swatch
          label={t("Accent")}
          value={theme.accent ?? theme.ansi[4]}
          onChange={(v) => set({ accent: v })}
        />
      </div>
      <div className="swatches ansi">
        {ANSI_NAMES.map((n, i) => (
          <Swatch key={n} label={n} value={theme.ansi[i]} onChange={(v) => setAnsi(i, v)} />
        ))}
      </div>
      <div className="confirm-actions">
        <button className="btn" onClick={onDone}>
          {t("Cancel")}
        </button>
        <button className="btn primary" disabled={!theme.name.trim()} onClick={() => void save()}>
          {t("Save")}
        </button>
      </div>
    </div>
  );
}

export function ThemesSection() {
  const userThemes = useConfig((s) => s.userThemes);
  const cfg = useConfig((s) => s.config.theme);
  const themes = useMemo(() => allThemes({ userThemes }), [userThemes]);
  const [slot, setSlot] = useState<"dark" | "light">(cfg.mode === "light" ? "light" : "dark");
  const [editing, setEditing] = useState<Theme | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const current = themes.find((x) => x.name === cfg[slot]) ?? themes[0];

  if (editing) return <Editor initial={editing} onDone={() => setEditing(null)} />;

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      setEditing(importTheme(f.name, await f.text()));
    } catch (e) {
      useWorkspace.getState().showToast((e as Error).message, "warn");
    }
  };

  return (
    <>
      <Select
        path={["theme", "mode"]}
        label={t("Mode")}
        options={[
          { value: "dark", label: t("Dark") },
          { value: "light", label: t("Light") },
          { value: "system", label: t("System") },
        ]}
      />
      <div className="set-row">
        <span className="set-label">{t("Theme for")}</span>
        <span className="set-control seg-buttons">
          <button className={slot === "dark" ? "on" : ""} onClick={() => setSlot("dark")}>
            {t("Dark")}
          </button>
          <button className={slot === "light" ? "on" : ""} onClick={() => setSlot("light")}>
            {t("Light")}
          </button>
        </span>
      </div>
      <div className="theme-grid">
        {themes.map((th) => (
          <Card
            key={th.name}
            theme={th}
            selected={th.name === cfg[slot]}
            onClick={() => void setValue(["theme", slot], th.name)}
          />
        ))}
      </div>
      <div className="set-actions">
        <button
          className="btn"
          onClick={() => setEditing({ ...current, name: `${current.name} Custom` })}
        >
          {t("Customize")}
        </button>
        <button className="btn" onClick={() => file.current?.click()}>
          {t("Import…")}
        </button>
        <button
          className="btn"
          onClick={() => {
            void writeText(themeToToml(current));
            useWorkspace.getState().showToast(t("Theme copied as TOML"));
          }}
        >
          {t("Export")}
        </button>
        <input
          ref={file}
          type="file"
          hidden
          accept=".itermcolors,.json,.yaml,.yml,.toml,.conf,*"
          onChange={(e) => void onImport(e.target.files?.[0])}
        />
      </div>
    </>
  );
}
