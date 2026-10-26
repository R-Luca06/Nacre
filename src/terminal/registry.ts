import { type LaunchOptions, type SessionEvents, TerminalSession } from "./session";
import { findTheme, fontStack, terminalSettings, useConfig } from "../store/config";
import { xtermTheme } from "../themes/apply";

/** Per-pane look from a profile; empty fields keep the global value. */
export interface PaneLook {
  theme?: string;
  fontFamily?: string;
  fontSize?: number;
}

const sessions = new Map<string, TerminalSession>();
const looks = new Map<string, PaneLook>();
let eventsFor: (id: string) => SessionEvents = () => ({});

/** Wires session callbacks to the app once at startup. */
export function setSessionEvents(factory: (id: string) => SessionEvents) {
  eventsFor = factory;
}

export function paneSettings(id: string) {
  const base = terminalSettings();
  const look = looks.get(id);
  if (!look) return base;
  const theme = look.theme ? findTheme(look.theme) : undefined;
  const zoom = useConfig.getState().zoom;
  return {
    ...base,
    theme: theme ? xtermTheme(theme) : base.theme,
    fontFamily: look.fontFamily ? fontStack(look.fontFamily) : base.fontFamily,
    fontSize: look.fontSize ? Math.max(6, look.fontSize + zoom) : base.fontSize,
  };
}

export function createSession(id: string, launch: LaunchOptions, look?: PaneLook): TerminalSession {
  const existing = sessions.get(id);
  if (existing) return existing;
  if (look) looks.set(id, look);
  const s = new TerminalSession(id, paneSettings(id), launch, eventsFor(id));
  sessions.set(id, s);
  return s;
}

export const getSession = (id: string) => sessions.get(id);

export function setPaneLook(id: string, look: PaneLook | undefined) {
  const prev = looks.get(id);
  if (JSON.stringify(prev) === JSON.stringify(look)) return;
  if (look) looks.set(id, look);
  else looks.delete(id);
  sessions.get(id)?.update(paneSettings(id));
}

export const paneLook = (id: string) => looks.get(id);

export function disposeSession(id: string) {
  sessions.get(id)?.dispose();
  sessions.delete(id);
  looks.delete(id);
}

export function allSessions() {
  return [...sessions.values()];
}

export function updateAllSessions() {
  for (const s of sessions.values()) s.update(paneSettings(s.id));
}
