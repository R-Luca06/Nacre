import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { t } from "../i18n";
import { useConfig } from "../store/config";
import { activeTab, useWorkspace } from "../store/workspace";
import { focusPane } from "../app/ops";
import { segmentIds } from "../statusbar/segments";
import { connectClaude, disconnectClaude, useInstallStatus } from "../claude/install";
import { ListField, NumberField, Select, TextField, Toggle, setValue } from "./fields";
import { usePlugins } from "../plugins/host";
import { ThemesSection } from "./ThemesSection";
import { KeysSection } from "./KeysSection";
import { availableMonoFonts } from "./fonts";
import "./settings.css";

type SectionId =
  "general" | "appearance" | "terminal" | "statusbar" | "claude" | "ai" | "keys" | "plugins";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "terminal", label: "Terminal" },
  { id: "statusbar", label: "Status Bar" },
  { id: "claude", label: "Claude" },
  { id: "ai", label: "AI" },
  { id: "keys", label: "Shortcuts" },
  { id: "plugins", label: "Plugins" },
];

const opts = (...values: [string, string][]) =>
  values.map(([value, label]) => ({ value, label: t(label) }));

const SEGMENT_LABELS: Record<string, string> = {
  cwd: "Directory",
  git: "Git",
  time: "Time",
  process: "Process",
  cpu: "CPU",
  mem: "Memory",
  battery: "Battery",
  net: "Network",
  tools: "Tool versions",
  kube: "Kubernetes",
  docker: "Docker",
  aws: "AWS profile",
  venv: "Python env",
  claude: "Claude",
  "claude.state": "Claude state",
  "claude.model": "Claude model",
  "claude.context": "Claude context",
  "claude.cost": "Claude cost",
  "claude.limits": "Claude limits",
  "claude.duration": "Claude duration",
};

function General() {
  return (
    <>
      <Select
        path={["general", "language"]}
        label={t("Language")}
        options={opts(["auto", "System"], ["en", "English"], ["fr", "Français"])}
      />
      <Toggle path={["general", "confirm_close"]} label={t("Confirm before closing")} />
      <Toggle path={["general", "restore_session"]} label={t("Restore windows")} />
      <NumberField
        path={["general", "restore_scrollback"]}
        label={t("Restored lines")}
        min={0}
        max={100000}
        step={100}
      />
      <TextField path={["shell", "program"]} label={t("Shell")} placeholder={t("Login shell")} />
      <TextField path={["shell", "cwd"]} label={t("Start in")} placeholder="~" />
      <Toggle path={["shell", "integration"]} label={t("Shell integration")} />
      <TextField
        path={["general", "editor"]}
        label={t("Open files with")}
        placeholder="code -g {file}:{line}:{col}"
      />
      <Toggle path={["general", "tray"]} label={t("Menu bar icon")} />
      <Toggle path={["general", "launch_at_login"]} label={t("Open at login")} />
      <Toggle path={["general", "secure_input"]} label={t("Secure Keyboard Entry")} />
      <Toggle path={["general", "check_updates"]} label={t("Check for updates")} />
      <div className="set-group-title">{t("Drop-down Terminal")}</div>
      <Toggle path={["quake", "enabled"]} label={t("Enable")} />
      <TextField path={["quake", "shortcut"]} label={t("Global shortcut")} placeholder="ctrl+`" />
      <NumberField path={["quake", "height"]} label={t("Height")} min={0.2} max={1} step={0.05} />
      <Toggle path={["quake", "hide_on_blur"]} label={t("Hide when unfocused")} />
      <ConfigTransfer />
    </>
  );
}

function ConfigTransfer() {
  const file = useRef<HTMLInputElement>(null);
  const ws = useWorkspace.getState;
  const exportConfig = async () => {
    try {
      const text = await invoke<string>("config_read");
      const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
      const path = await invoke<string>("save_download", {
        name: "nacre-config.toml",
        base64: b64,
      });
      ws().showToast(t("Saved to {path}", { path: path.replace(/^.*\/Downloads/, "~/Downloads") }));
    } catch (e) {
      ws().showToast(String(e), "warn");
    }
  };
  const importConfig = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    ws().setOverlay({
      kind: "confirm",
      confirm: {
        title: t("Replace config?"),
        detail: t("{name} replaces config.toml. The current file is kept as config.toml.bak.", {
          name: f.name,
        }),
        action: t("Replace"),
        onConfirm: () =>
          void invoke("config_replace", { contents: text }).catch((e) =>
            ws().showToast(String(e), "warn"),
          ),
      },
    });
  };
  return (
    <div className="set-row">
      <span className="set-label">{t("Config file")}</span>
      <span className="set-control">
        <button className="btn" onClick={() => file.current?.click()}>
          {t("Import…")}
        </button>
        <button className="btn" onClick={() => void exportConfig()}>
          {t("Export")}
        </button>
        <input
          ref={file}
          type="file"
          hidden
          accept=".toml"
          onChange={(e) => void importConfig(e.target.files?.[0])}
        />
      </span>
    </div>
  );
}

function Appearance() {
  const fonts = useMemo(() => availableMonoFonts(), []);
  return (
    <>
      <ThemesSection />
      <div className="set-group-title">{t("Text")}</div>
      <TextField path={["font", "family"]} label={t("Font")} list={fonts} />
      <NumberField
        path={["font", "size"]}
        label={t("Size")}
        min={6}
        max={72}
        step={0.5}
        unit="pt"
      />
      <NumberField
        path={["font", "line_height"]}
        label={t("Line height")}
        min={0.8}
        max={3}
        step={0.05}
      />
      <NumberField
        path={["font", "letter_spacing"]}
        label={t("Letter spacing")}
        min={-5}
        max={20}
        step={0.5}
      />
      <Toggle path={["font", "ligatures"]} label={t("Ligatures")} />
      <div className="set-group-title">{t("Cursor")}</div>
      <Select
        path={["cursor", "style"]}
        label={t("Style")}
        options={opts(["block", "Block"], ["bar", "Bar"], ["underline", "Underline"])}
      />
      <Toggle path={["cursor", "blink"]} label={t("Blink")} />
      <div className="set-group-title">{t("Window")}</div>
      <NumberField path={["window", "padding"]} label={t("Padding")} min={0} max={64} unit="px" />
      <NumberField
        path={["window", "dim_inactive"]}
        label={t("Dim inactive panes")}
        min={0}
        max={0.9}
        step={0.05}
      />
      <NumberField
        path={["window", "opacity"]}
        label={t("Opacity")}
        min={0.2}
        max={1}
        step={0.05}
      />
      <Toggle path={["window", "blur"]} label={t("Blur behind")} />
      <TextField
        path={["window", "background_image"]}
        label={t("Background image")}
        placeholder="~/Pictures/…"
      />
      <NumberField
        path={["window", "background_image_opacity"]}
        label={t("Image strength")}
        min={0}
        max={1}
        step={0.05}
      />
      <TextField
        path={["window", "background_gradient"]}
        label={t("Background gradient")}
        placeholder="linear-gradient(…)"
      />
      <Select
        path={["window", "effect"]}
        label={t("Effect")}
        options={opts(
          ["none", "None"],
          ["scanlines", "Scanlines"],
          ["glow", "Glow"],
          ["crt", "CRT"],
        )}
      />
      <Toggle path={["cursor", "trail"]} label={t("Cursor trail")} />
      <Select
        path={["window", "tabs"]}
        label={t("Tabs")}
        options={opts(["top", "Top"], ["left", "Sidebar"])}
      />
    </>
  );
}

function Terminal() {
  return (
    <>
      <NumberField
        path={["terminal", "scrollback"]}
        label={t("Scrollback")}
        min={0}
        max={1000000}
        step={1000}
        unit={t("lines")}
      />
      <Select
        path={["terminal", "option_as_meta"]}
        label={t("Option as Meta")}
        options={opts(["none", "Off"], ["left", "Left"], ["right", "Right"], ["both", "Both"])}
      />
      <Toggle path={["terminal", "copy_on_select"]} label={t("Copy on select")} />
      <Toggle path={["terminal", "paste_warning"]} label={t("Warn on risky paste")} />
      <Select
        path={["terminal", "bell"]}
        label={t("Bell")}
        options={opts(
          ["none", "Off"],
          ["visual", "Flash"],
          ["sound", "Sound"],
          ["notify", "Notification"],
        )}
      />
      <Toggle path={["terminal", "prompt_marks"]} label={t("Command marks")} />
      <Toggle path={["terminal", "scrollback_disk"]} label={t("Scrollback on disk")} />
      <Toggle path={["terminal", "autosuggest"]} label={t("Suggestions")} />
      <Toggle path={["terminal", "images"]} label={t("Inline images")} />
      <Toggle path={["terminal", "mask_secrets"]} label={t("Hide secrets")} />
      <Toggle path={["terminal", "screen_reader"]} label={t("Screen reader")} />
      <NumberField
        path={["terminal", "minimum_contrast"]}
        label={t("Minimum contrast")}
        min={1}
        max={21}
        step={0.5}
      />
      <Toggle path={["terminal", "block_separators"]} label={t("Block separators")} />
      <NumberField
        path={["terminal", "notify_after"]}
        label={t("Notify after")}
        min={0}
        max={86400}
        unit="s"
      />
    </>
  );
}

function StatusBarSection() {
  const custom = useConfig((s) => s.config.statusbar.custom);
  const choices = ["claude", ...segmentIds(), ...custom.map((c) => `custom:${c.name}`)];
  const labelOf = (id: string) =>
    id.startsWith("custom:") ? id.slice(7) : t(SEGMENT_LABELS[id] ?? id);
  return (
    <>
      <Toggle path={["statusbar", "enabled"]} label={t("Show")} />
      <Select
        path={["statusbar", "position"]}
        label={t("Position")}
        options={opts(["bottom", "Bottom"], ["top", "Top"])}
      />
      <Select
        path={["statusbar", "scope"]}
        label={t("One bar per")}
        options={opts(["window", "Window"], ["pane", "Pane"])}
      />
      <Select
        path={["statusbar", "style"]}
        label={t("Style")}
        options={opts(
          ["minimal", "Minimal"],
          ["simple", "Simple"],
          ["powerline", "Powerline"],
          ["pills", "Pills"],
        )}
      />
      <ListField
        path={["statusbar", "left"]}
        label={t("Left")}
        choices={choices}
        labelOf={labelOf}
      />
      <ListField
        path={["statusbar", "center"]}
        label={t("Center")}
        choices={choices}
        labelOf={labelOf}
      />
      <ListField
        path={["statusbar", "right"]}
        label={t("Right")}
        choices={choices}
        labelOf={labelOf}
      />
      <Select
        path={["statusbar", "time_format"]}
        label={t("Clock")}
        options={opts(["24h", "24 h"], ["24h-seconds", "24 h + seconds"], ["12h", "12 h"])}
      />
    </>
  );
}

function ClaudeSection() {
  const install = useInstallStatus();
  return (
    <>
      <div className="set-row">
        <span className="set-label">{t("Claude Code hooks")}</span>
        <span className="set-control">
          {install?.hooks ? (
            <button className="btn" onClick={() => disconnectClaude()}>
              {t("Disconnect")}
            </button>
          ) : (
            <button className="btn primary" onClick={() => void connectClaude()}>
              {t("Connect")}
            </button>
          )}
        </span>
      </div>
      <NumberField
        path={["claude", "context_warn"]}
        label={t("Context warning")}
        min={1}
        max={100}
        unit="%"
      />
      <NumberField
        path={["claude", "context_danger"]}
        label={t("Context danger")}
        min={1}
        max={100}
        unit="%"
      />
      <NumberField
        path={["claude", "context_alert"]}
        label={t("Context alert")}
        min={1}
        max={100}
        unit="%"
      />
      <Toggle path={["claude", "notify"]} label={t("Notifications")} />
      <Toggle path={["claude", "sound"]} label={t("Sound")} />
      <Toggle path={["claude", "dock_badge"]} label={t("Dock badge")} />
    </>
  );
}

function AiSection() {
  const provider = useConfig((s) => s.config.ai.provider);
  const claudePath = useConfig((s) => s.config.ai.claude_path);
  const [status, setStatus] = useState<{ claude: string | null; apiKey: boolean } | null>(null);
  const [key, setKey] = useState("");
  const refresh = () =>
    void invoke<{ claude: string | null; apiKey: boolean }>("ai_status", {
      claudePath: claudePath || null,
    }).then(setStatus);
  useEffect(refresh, [claudePath]);
  const saveKey = async (value: string | null) => {
    try {
      await invoke("ai_set_key", { key: value });
      setKey("");
      refresh();
    } catch (e) {
      useWorkspace.getState().showToast(String(e), "warn");
    }
  };
  const models = ["haiku", "sonnet", "opus", "fable"].map((m) => ({
    value: m,
    label: m[0].toUpperCase() + m.slice(1),
  }));
  return (
    <>
      <Select
        path={["ai", "provider"]}
        label={t("Use")}
        options={[
          { value: "claude-code", label: "Claude Code" },
          { value: "api", label: t("API key") },
        ]}
      />
      <Select path={["ai", "model"]} label={t("Model for commands")} options={models} />
      <Select path={["ai", "chat_model"]} label={t("Model for chat")} options={models} />
      <Toggle path={["ai", "auto_fix"]} label={t("Suggest a fix after errors")} />
      {provider === "claude-code" ? (
        <>
          <TextField
            path={["ai", "claude_path"]}
            label={t("Claude Code path")}
            placeholder={status?.claude ?? t("Not found")}
          />
        </>
      ) : (
        <div className="set-row">
          <span className="set-label">{t("API key")}</span>
          <span className="set-control">
            {status?.apiKey ? (
              <>
                <span className="dim">{t("Saved in Keychain")}</span>
                <button className="btn" onClick={() => void saveKey(null)}>
                  {t("Remove")}
                </button>
              </>
            ) : (
              <>
                <input
                  className="text"
                  type="password"
                  value={key}
                  placeholder="sk-ant-…"
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && key && void saveKey(key)}
                />
                <button className="btn" disabled={!key} onClick={() => void saveKey(key)}>
                  {t("Save")}
                </button>
              </>
            )}
          </span>
        </div>
      )}
    </>
  );
}

function PluginsSection() {
  const list = usePlugins((s) => s.list);
  const disabled = useConfig((s) => s.config.plugins.disabled);
  const toggle = (name: string) =>
    void setValue(
      ["plugins", "disabled"],
      disabled.includes(name) ? disabled.filter((n) => n !== name) : [...disabled, name],
    );
  return (
    <>
      {list.length === 0 && <div className="set-row dim">{t("No plugins installed.")}</div>}
      {list.map((p) => (
        <div key={p.name} className="set-row">
          <span className="set-label">
            {p.name}
            {p.error && <span className="key-clash">{p.error}</span>}
          </span>
          <span className="set-control">
            <button
              className={`toggle${p.state !== "disabled" ? " on" : ""}`}
              role="switch"
              aria-checked={p.state !== "disabled"}
              onClick={() => toggle(p.name)}
            >
              <span />
            </button>
          </span>
        </div>
      ))}
      <div className="set-actions" style={{ marginTop: 12 }}>
        <button
          className="btn"
          onClick={() => void invoke<string>("plugins_dir").then((d) => openPath(d))}
        >
          {t("Open plugins folder")}
        </button>
      </div>
    </>
  );
}

export function Settings() {
  const [section, setSection] = useState<SectionId>("appearance");
  const path = useConfig((s) => s.path);
  const close = () => {
    useWorkspace.getState().setOverlay(null);
    const tab = activeTab();
    if (tab) focusPane(tab.active);
  };
  return (
    <div
      className="settings"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) close();
      }}
      tabIndex={-1}
    >
      <nav className="settings-nav">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={section === s.id ? "on" : ""}
            onClick={() => setSection(s.id)}
          >
            {t(s.label)}
          </button>
        ))}
        <span className="grow" />
        <button className="settings-file" onClick={() => path && void openPath(path)}>
          config.toml
        </button>
      </nav>
      <div className="settings-body">
        <button className="icon-btn settings-close" onClick={close}>
          <X size={14} strokeWidth={1.5} />
        </button>
        <div className="settings-page">
          <h2>{t(SECTIONS.find((s) => s.id === section)!.label)}</h2>
          {section === "general" && <General />}
          {section === "appearance" && <Appearance />}
          {section === "terminal" && <Terminal />}
          {section === "statusbar" && <StatusBarSection />}
          {section === "claude" && <ClaudeSection />}
          {section === "ai" && <AiSection />}
          {section === "keys" && <KeysSection />}
          {section === "plugins" && <PluginsSection />}
        </div>
      </div>
    </div>
  );
}
