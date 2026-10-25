import { type LaunchOptions, type SessionEvents, TerminalSession } from "./session";
import { terminalSettings } from "../store/config";

const sessions = new Map<string, TerminalSession>();
let eventsFor: (id: string) => SessionEvents = () => ({});

/** Wires session callbacks to the app once at startup. */
export function setSessionEvents(factory: (id: string) => SessionEvents) {
  eventsFor = factory;
}

export function createSession(id: string, launch: LaunchOptions): TerminalSession {
  const existing = sessions.get(id);
  if (existing) return existing;
  const s = new TerminalSession(id, terminalSettings(), launch, eventsFor(id));
  sessions.set(id, s);
  return s;
}

export const getSession = (id: string) => sessions.get(id);

export function disposeSession(id: string) {
  sessions.get(id)?.dispose();
  sessions.delete(id);
}

export function allSessions() {
  return [...sessions.values()];
}

export function updateAllSessions() {
  const settings = terminalSettings();
  for (const s of sessions.values()) s.update(settings);
}
