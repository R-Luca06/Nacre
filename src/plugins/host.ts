import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { registerAction, unregisterAction } from "../app/actions";
import { refreshMenu } from "../app/menu";
import type { TriggerRule } from "../config/schema";
import { rebuildKeymap } from "../keybindings/runtime";
import {
  type SegmentContext,
  type SegmentValue,
  registerSegment,
  unregisterSegment,
} from "../statusbar/segments";
import { useConfig } from "../store/config";
import { activeTab, useWorkspace } from "../store/workspace";
import { getSession } from "../terminal/registry";
import { themeFromRaw } from "../themes/themeFile";
import type { Theme } from "../themes/types";

interface PluginFile {
  name: string;
  path: string;
  code: string | null;
  error: string | null;
}

export interface PluginStatus {
  name: string;
  path: string;
  state: "active" | "disabled" | "error";
  error?: string;
}

export const usePlugins = create<{ list: PluginStatus[] }>(() => ({ list: [] }));

export interface CommandFinished {
  paneId: string;
  command?: string;
  exitCode?: number;
  duration: number;
  cwd?: string;
}

/** What a plugin's `activate(nacre)` receives. Version 1. */
export interface NacreApi {
  version: 1;
  registerSegment(def: {
    id: string;
    interval?: number;
    compute: (ctx: {
      cwd?: string;
      process?: string;
    }) => SegmentValue | null | Promise<SegmentValue | null>;
    click?: (ctx: { cwd?: string }) => void;
  }): void;
  registerCommand(cmd: { id: string; label: string; keys?: string[]; run: () => void }): void;
  registerTheme(theme: Record<string, unknown>): void;
  registerTrigger(rule: {
    regex: string;
    run: (match: string[], line: string, paneId: string) => void;
  }): void;
  onCommandFinished(cb: (e: CommandFinished) => void): void;
  notify(title: string, body?: string): void;
  sendText(text: string): void;
  activePane(): { id: string; cwd?: string; process?: string } | null;
  runScript(command: string, cwd?: string): Promise<string | null>;
}

interface Instance {
  segments: string[];
  commands: string[];
  themes: Theme[];
  triggers: TriggerRule[];
  finished: ((e: CommandFinished) => void)[];
  cleanup?: () => void;
}

const instances = new Map<string, Instance>();

export function emitCommandFinished(e: CommandFinished) {
  for (const inst of instances.values()) {
    for (const cb of inst.finished) {
      try {
        cb(e);
      } catch (err) {
        console.error(err);
      }
    }
  }
}

function syncContributions() {
  const themes = [...instances.values()].flatMap((i) => i.themes);
  const triggers = [...instances.values()].flatMap((i) => i.triggers);
  useConfig.setState({ pluginThemes: themes, pluginTriggers: triggers });
  rebuildKeymap(useConfig.getState().config.keys);
  refreshMenu();
}

function api(name: string, inst: Instance): NacreApi {
  const ctxOf = (c: SegmentContext) => ({
    cwd: c.meta?.cwd,
    process: c.meta?.proc && !c.meta.proc.isShell ? c.meta.proc.name : undefined,
  });
  return {
    version: 1,
    registerSegment(def) {
      const id = `plugin.${def.id}`;
      registerSegment({
        id,
        interval: def.interval,
        deps: (c) => [c.meta?.cwd, c.meta?.proc?.name],
        compute: (c) => def.compute(ctxOf(c)),
        click: def.click ? (c) => def.click!(ctxOf(c)) : undefined,
      });
      inst.segments.push(id);
    },
    registerCommand(cmd) {
      const id = `plugin.${name}.${cmd.id}`;
      registerAction({ id, label: cmd.label, group: "App", keys: cmd.keys ?? [], run: cmd.run });
      inst.commands.push(id);
    },
    registerTheme(raw) {
      const r = themeFromRaw(raw, `${name}.js`);
      if (r.theme) inst.themes.push(r.theme);
      else throw new Error(r.error);
    },
    registerTrigger(rule) {
      new RegExp(rule.regex);
      inst.triggers.push({ regex: rule.regex, action: "plugin", run: rule.run });
    },
    onCommandFinished(cb) {
      inst.finished.push(cb);
    },
    notify(title, body = "") {
      void invoke("notify", { title, body });
    },
    sendText(text) {
      const id = activeTab()?.active;
      if (id) getSession(id)?.send(text);
    },
    activePane() {
      const id = activeTab()?.active;
      if (!id) return null;
      const meta = useWorkspace.getState().panes[id];
      return {
        id,
        cwd: meta?.cwd,
        process: meta?.proc && !meta.proc.isShell ? meta.proc.name : undefined,
      };
    },
    runScript(command, cwd) {
      return invoke<string | null>("run_script", { command, cwd: cwd ?? null, timeout: 10000 });
    },
  };
}

function unload(name: string) {
  const inst = instances.get(name);
  if (!inst) return;
  try {
    inst.cleanup?.();
  } catch (e) {
    console.error(e);
  }
  inst.segments.forEach(unregisterSegment);
  inst.commands.forEach(unregisterAction);
  instances.delete(name);
}

async function load(f: PluginFile): Promise<PluginStatus> {
  const base = { name: f.name, path: f.path };
  if (!f.code) return { ...base, state: "error", error: f.error ?? "unreadable" };
  const inst: Instance = { segments: [], commands: [], themes: [], triggers: [], finished: [] };
  const url = URL.createObjectURL(new Blob([f.code], { type: "text/javascript" }));
  try {
    const mod = await import(/* @vite-ignore */ url);
    const activate = mod.default ?? mod.activate;
    if (typeof activate !== "function")
      throw new Error("export default function activate(nacre) {…}");
    instances.set(f.name, inst);
    const cleanup = await activate(api(f.name, inst));
    if (typeof cleanup === "function") inst.cleanup = cleanup;
    return { ...base, state: "active" };
  } catch (e) {
    unload(f.name);
    return { ...base, state: "error", error: String((e as Error)?.message ?? e) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function apply(files: PluginFile[]) {
  const disabled = new Set(useConfig.getState().config.plugins.disabled);
  for (const name of [...instances.keys()]) unload(name);
  const list: PluginStatus[] = [];
  for (const f of files) {
    if (disabled.has(f.name)) list.push({ name: f.name, path: f.path, state: "disabled" });
    else list.push(await load(f));
  }
  usePlugins.setState({ list });
  syncContributions();
}

let files: PluginFile[] = [];

export async function initPlugins() {
  files = await invoke<PluginFile[]>("plugins_load").catch(() => []);
  await apply(files);
  await listen<PluginFile[]>("plugins-changed", (e) => {
    files = e.payload;
    void apply(files);
  });
  useConfig.subscribe((s, prev) => {
    if (s.config.plugins.disabled !== prev.config.plugins.disabled) void apply(files);
  });
}
