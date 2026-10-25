import { Channel, invoke } from "@tauri-apps/api/core";

export interface SpawnOptions {
  cols: number;
  rows: number;
  cwd?: string;
  shell?: string;
  args?: string[];
  env?: Record<string, string>;
  command?: string;
}

export interface ExitInfo {
  code: number | null;
  signal: string | null;
}

export interface ProcInfo {
  pid: number;
  name: string;
  cwd: string | null;
  isShell: boolean;
}

export function spawn(
  id: string,
  opts: SpawnOptions,
  onData: (data: Uint8Array) => void,
  onExit: (info: ExitInfo) => void,
): Promise<number> {
  const data = new Channel<ArrayBuffer>();
  data.onmessage = (buf) => onData(new Uint8Array(buf));
  const exit = new Channel<ExitInfo>();
  exit.onmessage = onExit;
  return invoke("pty_spawn", { id, opts, onData: data, onExit: exit });
}

export const write = (id: string, data: string) => invoke<void>("pty_write", { id, data });
export const resize = (id: string, cols: number, rows: number) =>
  invoke<void>("pty_resize", { id, cols, rows });
export const ack = (id: string, bytes: number) => invoke<void>("pty_ack", { id, bytes });
export const kill = (id: string) => invoke<void>("pty_kill", { id });
export const info = (id: string) => invoke<ProcInfo | null>("pty_info", { id });
