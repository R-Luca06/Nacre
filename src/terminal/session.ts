import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { SerializeAddon } from "@xterm/addon-serialize";
import { ImageAddon } from "@xterm/addon-image";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import * as pty from "../ipc/pty";
import { withAlpha } from "../themes/color";
import { type Block, CommandTracker } from "./blocks";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { copyText as writeText } from "../app/clipboard";
import { invoke } from "@tauri-apps/api/core";
import { fileLinkProvider } from "./fileLinks";
import { LineScanner } from "./scanner";
import { Recorder, parseCast, play } from "./recording";
import { ANSI_NAMES } from "../themes/types";
import type { HighlightRule, TriggerRule } from "../config/schema";

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  scrollback: number;
  optionAsMeta: "none" | "left" | "right" | "both";
  copyOnSelect: boolean;
  ligatures: boolean;
  promptMarks: boolean;
  blockSeparators: boolean;
  wordSeparators: string;
  /** The background shows through (window opacity, blur, image). */
  transparent: boolean;
  images: boolean;
  maskSecrets: boolean;
  screenReader: boolean;
  minimumContrast: number;
  highlight: HighlightRule[];
  triggers: TriggerRule[];
  padding: number;
  theme: ITheme;
}

export interface SessionEvents {
  onKey?: (e: KeyboardEvent, session: TerminalSession) => boolean;
  /** Intercepts user input; return true when handled (e.g. broadcast). */
  onInput?: (data: string, session: TerminalSession) => boolean;
  onCwd?: (cwd: string) => void;
  onCommandFinished?: (block: Block) => void;
  /** Directory used to resolve relative file paths in output. */
  cwd?: () => string | undefined;
  openFile?: (file: string, line?: number, col?: number) => void;
  onTrigger?: (rule: TriggerRule, match: RegExpMatchArray, line: string) => void;
  onTitle?: (title: string) => void;
  onBell?: () => void;
  onOutput?: () => void;
  onExit?: (info: pty.ExitInfo) => void;
  onFocus?: () => void;
  onSelection?: (text: string) => void;
}

export interface LaunchOptions {
  integration?: boolean;
  /** asciicast text to play instead of starting a shell. */
  replay?: string;
  cwd?: string;
  shell?: string;
  args?: string[];
  env?: Record<string, string>;
  command?: string;
}

const ACK_EVERY = 128 * 1024;

export class TerminalSession {
  readonly id: string;
  readonly term: Terminal;
  readonly host: HTMLDivElement;
  readonly events: SessionEvents;
  private fitAddon = new FitAddon();
  private searchAddon = new SearchAddon({ highlightLimit: 2000 });
  private serializeAddon = new SerializeAddon();
  private webgl: WebglAddon | null = null;
  private ligatures: LigaturesAddon | null = null;
  private opened = false;
  private started = false;
  private visible = true;
  private unacked = 0;
  private swallowKeypress = false;
  private settings: TerminalSettings;
  private launch: LaunchOptions;
  private searchListeners = new Set<(index: number, count: number) => void>();
  readonly commands: CommandTracker;
  private scanner: LineScanner;
  exited: pty.ExitInfo | null = null;
  pid = 0;

  constructor(
    id: string,
    settings: TerminalSettings,
    launch: LaunchOptions,
    events: SessionEvents,
  ) {
    this.id = id;
    this.settings = settings;
    this.launch = launch;
    this.events = events;
    this.host = document.createElement("div");
    this.host.className = "term-host";
    this.term = new Terminal({
      allowProposedApi: true,
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: false,
      drawBoldTextInBrightColors: false,
      ...this.xtermOptions(settings),
      linkHandler: {
        activate: (e, uri) => this.openLink(e, uri),
        allowNonHttpProtocols: true,
      },
    });
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.searchAddon);
    this.term.loadAddon(this.serializeAddon);
    const unicode = new Unicode11Addon();
    this.term.loadAddon(unicode);
    this.term.unicode.activeVersion = "11";
    this.term.loadAddon(new WebLinksAddon((e, uri) => this.openLink(e, uri)));
    // OSC 52: programs may set the clipboard (vim, tmux over SSH); reading it is refused.
    this.term.loadAddon(
      new ClipboardAddon(undefined, {
        readText: () => "",
        writeText: (_sel, text) => writeText(text),
      }),
    );
    if (events.openFile) {
      this.term.registerLinkProvider(
        fileLinkProvider(
          this.term,
          () => events.cwd?.(),
          (cwd, paths) => invoke<(string | null)[]>("paths_exist", { cwd: cwd ?? null, paths }),
          events.openFile,
        ),
      );
    }

    this.term.attachCustomKeyEventHandler((e) => this.handleKey(e));
    this.term.onData((d) => this.input(d));
    this.term.onBinary((d) => this.input(d));
    this.commands = new CommandTracker(
      this.term,
      () => ({ marks: this.settings.promptMarks, separators: this.settings.blockSeparators }),
      (b) => this.events.onCommandFinished?.(b),
    );
    this.term.parser.registerOscHandler(133, (data) => this.commands.handle(data));
    this.scanner = new LineScanner(
      this.term,
      () => ANSI_NAMES.map((n) => this.settings.theme[n] ?? ""),
      (rule, m, line) => this.events.onTrigger?.(rule, m, line),
    );
    this.scanner.setRules(settings);
    this.term.parser.registerOscHandler(7, (data) => {
      const cwd = parseOsc7(data);
      if (cwd) this.events.onCwd?.(cwd);
      return true;
    });
    this.term.onResize(({ cols, rows }) => {
      if (this.started) void pty.resize(this.id, cols, rows);
    });
    this.term.onTitleChange((t) => this.events.onTitle?.(t));
    this.term.onBell(() => this.events.onBell?.());
    this.term.onSelectionChange(() => {
      const sel = this.term.getSelection();
      if (sel) this.events.onSelection?.(sel);
    });
    this.searchAddon.onDidChangeResults(({ resultIndex, resultCount }) =>
      this.searchListeners.forEach((l) => l(resultIndex, resultCount)),
    );
    this.host.addEventListener("focusin", () => this.events.onFocus?.());
    this.host.addEventListener("keydown", (e) => this.trackOption(e), true);
    this.host.addEventListener("keyup", (e) => this.trackOption(e), true);
  }

  private xtermOptions(s: TerminalSettings) {
    return {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      cursorStyle: s.cursorStyle,
      cursorBlink: s.cursorBlink,
      cursorInactiveStyle: "outline" as const,
      scrollback: s.scrollback,
      macOptionIsMeta: s.optionAsMeta === "both",
      wordSeparator: s.wordSeparators,
      allowTransparency: s.transparent,
      screenReaderMode: s.screenReader,
      minimumContrastRatio: s.minimumContrast,
      theme: s.transparent ? { ...s.theme, background: "#00000000" } : s.theme,
    };
  }

  /** Attaches the terminal to a container; first call opens xterm and starts the shell. */
  mount(container: HTMLElement) {
    if (this.host.parentElement !== container) container.appendChild(this.host);
    this.host.style.padding = `${this.settings.padding}px`;
    if (!this.opened) {
      this.term.open(this.host);
      this.opened = true;
      this.attachWebgl();
      this.syncLigatures();
      this.syncImages();
    }
    this.fit();
    if (!this.started) void this.start();
  }

  private attachWebgl() {
    if (this.webgl || !this.visible) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => this.detachWebgl());
      this.term.loadAddon(addon);
      this.webgl = addon;
    } catch {
      this.webgl = null;
    }
  }

  private detachWebgl() {
    this.webgl?.dispose();
    this.webgl = null;
  }

  /** Hidden terminals release their GPU context. */
  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!this.opened) return;
    if (visible) {
      this.attachWebgl();
      this.fit();
    } else {
      this.detachWebgl();
    }
  }

  private recorder: Recorder | null = null;
  private stopReplay: (() => void) | null = null;

  get isReplay() {
    return !!this.launch.replay;
  }

  get recording() {
    return this.recorder !== null;
  }

  startRecording() {
    this.recorder = new Recorder();
  }

  /** Returns the asciicast text. */
  stopRecording(): string | null {
    const r = this.recorder;
    this.recorder = null;
    return r ? r.toCast(this.term.cols, this.term.rows, this.launch.shell ?? "zsh") : null;
  }

  private async start() {
    this.started = true;
    if (this.launch.replay) {
      try {
        const cast = parseCast(this.launch.replay);
        this.stopReplay = play(
          cast,
          (d) => this.term.write(d),
          () => {
            this.exited = { code: 0, signal: null };
            this.term.write("\r\n\x1b[2m[end]\x1b[0m");
          },
        );
      } catch (e) {
        this.term.write(`\x1b[31m${String(e)}\x1b[0m\r\n`);
        this.exited = { code: 1, signal: null };
      }
      return;
    }
    try {
      this.pid = await pty.spawn(
        this.id,
        { cols: this.term.cols, rows: this.term.rows, ...this.launch },
        (data) => this.receive(data),
        (info) => {
          this.exited = info;
          this.events.onExit?.(info);
        },
      );
    } catch (err) {
      this.term.write(`\x1b[31m${String(err)}\x1b[0m\r\n`);
    }
  }

  private receive(data: Uint8Array) {
    this.recorder?.push(data);
    const n = data.length;
    this.term.write(data, () => {
      this.unacked += n;
      if (this.unacked >= ACK_EVERY) {
        void pty.ack(this.id, this.unacked);
        this.unacked = 0;
      }
    });
    this.events.onOutput?.();
  }

  private input(data: string) {
    if (this.events.onInput?.(data, this)) return;
    this.send(data);
  }

  send(data: string) {
    if (this.started && !this.exited) void pty.write(this.id, data);
  }

  fit() {
    if (!this.opened || !this.host.isConnected) return;
    if (this.host.clientWidth === 0 || this.host.clientHeight === 0) return;
    this.fitAddon.fit();
  }

  focus() {
    this.term.focus();
  }

  private images: ImageAddon | null = null;

  private syncImages() {
    if (!this.opened) return;
    if (this.settings.images && !this.images) {
      this.images = new ImageAddon({ sixelSupport: true, iipSupport: true, storageLimit: 64 });
      this.term.loadAddon(this.images);
    } else if (!this.settings.images && this.images) {
      this.images.dispose();
      this.images = null;
    }
  }

  private syncLigatures() {
    if (!this.opened) return;
    if (this.settings.ligatures && !this.ligatures) {
      try {
        this.ligatures = new LigaturesAddon();
        this.term.loadAddon(this.ligatures);
      } catch {
        this.ligatures = null;
      }
    } else if (!this.settings.ligatures && this.ligatures) {
      this.ligatures.dispose();
      this.ligatures = null;
    }
  }

  update(settings: TerminalSettings) {
    const marksChanged =
      settings.promptMarks !== this.settings.promptMarks ||
      settings.blockSeparators !== this.settings.blockSeparators;
    this.settings = settings;
    this.scanner.setRules({ ...settings, maskSecrets: settings.maskSecrets });
    this.syncImages();
    if (marksChanged) this.commands.refreshDecorations();
    Object.assign(this.term.options, this.xtermOptions(settings));
    this.syncLigatures();
    this.host.style.padding = `${settings.padding}px`;
    this.fit();
  }

  private handleKey(e: KeyboardEvent): boolean {
    if (e.type === "keypress") {
      if (this.swallowKeypress) {
        this.swallowKeypress = false;
        return false;
      }
      return true;
    }
    if (e.type !== "keydown") return true;
    if (this.events.onKey?.(e, this)) {
      e.preventDefault();
      this.swallowKeypress = true;
      return false;
    }
    this.swallowKeypress = false;
    return true;
  }

  /** Option as Meta can be limited to one side: switch xterm's flag per physical key. */
  private trackOption(e: KeyboardEvent) {
    const mode = this.settings.optionAsMeta;
    if (mode !== "left" && mode !== "right") return;
    if (e.code !== "AltLeft" && e.code !== "AltRight") return;
    const side = e.code === "AltLeft" ? "left" : "right";
    this.term.options.macOptionIsMeta = e.type === "keydown" && side === mode;
  }

  private openLink(e: MouseEvent, uri: string) {
    if (!e.metaKey) return;
    void openUrl(uri).catch(() => {});
  }

  hasSelection() {
    return this.term.hasSelection();
  }

  getSelection() {
    return this.term.getSelection();
  }

  paste(text: string) {
    this.term.paste(text);
  }

  find(query: string, opts: ISearchOptions, backwards = false) {
    const hl = this.settings.theme.yellow ?? "#e5c07b";
    const options: ISearchOptions = {
      ...opts,
      decorations: {
        matchBackground: withAlpha(hl, 0.25),
        matchOverviewRuler: withAlpha(hl, 0.5),
        activeMatchBackground: withAlpha(hl, 0.6),
        activeMatchColorOverviewRuler: hl,
      },
    };
    if (!query) {
      this.searchAddon.clearDecorations();
      this.searchListeners.forEach((l) => l(-1, 0));
      return false;
    }
    return backwards
      ? this.searchAddon.findPrevious(query, options)
      : this.searchAddon.findNext(query, options);
  }

  onSearchResults(fn: (index: number, count: number) => void) {
    this.searchListeners.add(fn);
    return () => void this.searchListeners.delete(fn);
  }

  /** Scrollback with colors, as ANSI text (alt screen excluded). */
  serialize(lines: number): string {
    return this.serializeAddon.serialize({
      scrollback: lines,
      excludeAltBuffer: true,
      excludeModes: true,
    });
  }

  serializeHtml(): string {
    return this.serializeAddon.serializeAsHTML({ includeGlobalBackground: true });
  }

  /** Shows text from a previous run above the new prompt. */
  restoreText(text: string) {
    if (!text) return;
    this.term.write(text.replace(/\n/g, "\r\n").replace(/\r\r\n/g, "\r\n") + "\x1b[0m\r\n");
  }

  clearSearch() {
    this.searchAddon.clearDecorations();
  }

  dispose() {
    this.stopReplay?.();
    if (!this.launch.replay) void pty.kill(this.id);
    this.detachWebgl();
    this.term.dispose();
    this.host.remove();
  }
}

/** `file://host/path` → `/path` */
export function parseOsc7(data: string): string | null {
  try {
    const url = new URL(data);
    if (url.protocol !== "file:") return null;
    return decodeURIComponent(url.pathname) || null;
  } catch {
    return null;
  }
}
