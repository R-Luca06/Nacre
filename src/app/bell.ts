import { getSession } from "../terminal/registry";

let audio: AudioContext | null = null;

function beep() {
  audio ??= new AudioContext();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.08, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.12);
}

let notifier: ((paneId: string) => void) | null = null;

export function setBellNotifier(fn: (paneId: string) => void) {
  notifier = fn;
}

export function ring(paneId: string, mode: string, visible: boolean) {
  if (mode === "none") return;
  if (mode === "sound") beep();
  if (mode === "notify" && !visible && notifier) notifier(paneId);
  const host = getSession(paneId)?.host;
  if (host && visible) {
    host.classList.remove("bell");
    void host.offsetWidth;
    host.classList.add("bell");
  }
}
