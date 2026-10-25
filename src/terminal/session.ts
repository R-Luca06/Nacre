import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import * as pty from "../ipc/pty";

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
  padding: number;
  theme: ITheme;
}

export interface SessionEvents {
  onKey?: (e: KeyboardEvent, session: TerminalSession) => boolean;
  onTitle?: (title: string) => void;
  onBell?: () => void;
  onOutput?: () => void;
  onExit?: (info: pty.ExitInfo) => void;
  onFocus?: () => void;
  onSelection?: (text: string) => void;
  onSearchResults?: (index: number, count: number) => void;
}

export interface LaunchOptions {
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
  private webgl: WebglAddon | null = null;
  private opened = false;
  private started = false;
  private visible = true;
  private unacked = 0;
  private swallowKeypress = false;
  private settings: TerminalSettings;
  private launch: LaunchOptions;
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
      allowTransparency: false,
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
    const unicode = new Unicode11Addon();
    this.term.loadAddon(unicode);
    this.term.unicode.activeVersion = "11";
    this.term.loadAddon(new WebLinksAddon((e, uri) => this.openLink(e, uri)));

    this.term.attachCustomKeyEventHandler((e) => this.handleKey(e));
    this.term.onData((d) => this.send(d));
    this.term.onBinary((d) => this.send(d));
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
      this.events.onSearchResults?.(resultIndex, resultCount),
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
      theme: s.theme,
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

  private async start() {
    this.started = true;
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

  update(settings: TerminalSettings) {
    this.settings = settings;
    Object.assign(this.term.options, this.xtermOptions(settings));
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
    const options: ISearchOptions = {
      ...opts,
      decorations: {
        matchBackground: "#ffffff33",
        matchOverviewRuler: "#ffffff66",
        activeMatchBackground: "#ffd34e99",
        activeMatchColorOverviewRuler: "#ffd34e",
      },
    };
    if (!query) {
      this.searchAddon.clearDecorations();
      this.events.onSearchResults?.(-1, 0);
      return false;
    }
    return backwards
      ? this.searchAddon.findPrevious(query, options)
      : this.searchAddon.findNext(query, options);
  }

  clearSearch() {
    this.searchAddon.clearDecorations();
  }

  dispose() {
    void pty.kill(this.id);
    this.detachWebgl();
    this.term.dispose();
    this.host.remove();
  }
}
