import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { defaults } from "../config/schema";
import { setConfigValue } from "../ipc/config";
import { useConfig } from "../store/config";
import { useWorkspace } from "../store/workspace";
import { t } from "../i18n";

export type Path = string[];

export function getAt(obj: unknown, path: Path): unknown {
  return path.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function setAt<T>(obj: T, path: Path, value: unknown): T {
  if (!path.length) return value as T;
  const [k, ...rest] = path;
  const o = (obj ?? {}) as Record<string, unknown>;
  return { ...o, [k]: setAt(o[k], rest, value) } as T;
}

/** Writes a setting; the default value removes the line so the file stays minimal. */
export async function setValue(path: Path, value: unknown) {
  const def = getAt(defaults, path);
  // Optimistic: the file watcher confirms a moment later.
  useConfig.setState((s) => ({ config: setAt(s.config, path, value) }));
  try {
    await setConfigValue(path, def !== undefined && same(def, value) ? null : value);
  } catch (e) {
    useWorkspace.getState().showToast(String(e), "warn");
  }
}

export function useSetting<T>(path: Path): [T, (v: T) => void] {
  const value = useConfig((s) => getAt(s.config, path)) as T;
  return [value, (v: T) => void setValue(path, v)];
}

export function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="set-row" title={hint}>
      <span className="set-label">{label}</span>
      <span className="set-control">{children}</span>
    </div>
  );
}

export function Toggle({ path, label }: { path: Path; label: string }) {
  const [v, set] = useSetting<boolean>(path);
  return (
    <Row label={label}>
      <button
        className={`toggle${v ? " on" : ""}`}
        role="switch"
        aria-checked={v}
        onClick={() => set(!v)}
      >
        <span />
      </button>
    </Row>
  );
}

export function Select({
  path,
  label,
  options,
}: {
  path: Path;
  label: string;
  options: { value: string; label: string }[];
}) {
  const [v, set] = useSetting<string>(path);
  return (
    <Row label={label}>
      <select value={v} onChange={(e) => set(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function NumberField({
  path,
  label,
  min,
  max,
  step = 1,
  unit,
}: {
  path: Path;
  label: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  const [v, set] = useSetting<number>(path);
  const commit = (el: HTMLInputElement) => {
    const n = Number(el.value);
    if (Number.isFinite(n) && n >= min && n <= max) {
      if (n !== v) set(n);
    } else el.value = String(v);
  };
  return (
    <Row label={label}>
      <input
        key={v}
        className="num"
        type="number"
        defaultValue={v}
        min={min}
        max={max}
        step={step}
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget)}
      />
      {unit && <span className="unit">{unit}</span>}
    </Row>
  );
}

export function TextField({
  path,
  label,
  placeholder,
  list,
}: {
  path: Path;
  label: string;
  placeholder?: string;
  list?: string[];
}) {
  const [v, set] = useSetting<string>(path);
  const id = `dl-${path.join("-")}`;
  const commit = (el: HTMLInputElement) => {
    if (el.value !== v) set(el.value);
  };
  return (
    <Row label={label}>
      <input
        key={v}
        className="text"
        defaultValue={v}
        placeholder={placeholder}
        spellCheck={false}
        list={list ? id : undefined}
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget)}
      />
      {list && (
        <datalist id={id}>
          {list.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      )}
    </Row>
  );
}

/** Ordered list of ids with add/remove/move, e.g. status bar segments. */
export function ListField({
  path,
  label,
  choices,
  labelOf,
}: {
  path: Path;
  label: string;
  choices: string[];
  labelOf: (id: string) => string;
}) {
  const [v, set] = useSetting<string[]>(path);
  const [adding, setAdding] = useState(false);
  const move = (i: number, d: number) => {
    const next = [...v];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  const available = choices.filter((c) => !v.includes(c));
  return (
    <Row label={label}>
      <span className="chips">
        {v.map((id, i) => (
          <span key={id} className="chip">
            <button className="chip-move" onClick={() => move(i, -1)} disabled={i === 0}>
              <ChevronLeft size={10} strokeWidth={1.5} />
            </button>
            {labelOf(id)}
            <button className="chip-move" onClick={() => move(i, 1)} disabled={i === v.length - 1}>
              <ChevronRight size={10} strokeWidth={1.5} />
            </button>
            <button className="chip-x" onClick={() => set(v.filter((x) => x !== id))}>
              <X size={10} strokeWidth={1.5} />
            </button>
          </span>
        ))}
        {adding ? (
          <select
            autoFocus
            value=""
            onBlur={() => setAdding(false)}
            onChange={(e) => {
              if (e.target.value) set([...v, e.target.value]);
              setAdding(false);
            }}
          >
            <option value="">{t("Add…")}</option>
            {available.map((c) => (
              <option key={c} value={c}>
                {labelOf(c)}
              </option>
            ))}
          </select>
        ) : (
          available.length > 0 && (
            <button className="icon-btn" onClick={() => setAdding(true)}>
              <Plus size={12} strokeWidth={1.5} />
            </button>
          )
        )}
      </span>
    </Row>
  );
}
