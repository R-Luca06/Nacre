/** `~/Development/nacre/src/app` → `~/D/n/src/app` when longer than `max`. */
export function shortenPath(path: string, max = 40): string {
  if (path.length <= max) return path;
  const parts = path.split("/");
  for (let i = 1; i < parts.length - 2 && parts.join("/").length > max; i++) {
    if (parts[i] && parts[i] !== "~")
      parts[i] = parts[i][0] === "." ? parts[i].slice(0, 2) : parts[i][0];
  }
  return parts.join("/");
}

export function formatBytes(n: number, digits = 1): string {
  const units = ["B", "K", "M", "G", "T"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(digits)}${units[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

export function formatTime(d: Date, fmt: "24h" | "24h-seconds" | "12h"): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (fmt === "12h") {
    const h = d.getHours() % 12 || 12;
    return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
  }
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return fmt === "24h-seconds" ? `${base}:${pad(d.getSeconds())}` : base;
}
