import { useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import { actions, actionLabel, defaultBindings } from "../app/actions";
import {
  type Combo,
  eventCombos,
  formatCombo,
  isModifierOnly,
  parseCombo,
} from "../keybindings/combo";
import { findConflicts } from "../keybindings/keymap";
import { currentBindings, onBindingsChange } from "../keybindings/runtime";
import { fuzzyFilter } from "../util/fuzzy";
import { t } from "../i18n";
import { setValue } from "./fields";

const GROUPS = ["Tab", "Pane", "Window", "Edit", "View", "App"] as const;

function useBindings() {
  const [b, setB] = useState(currentBindings());
  useEffect(() => onBindingsChange(() => setB(currentBindings())), []);
  return b;
}

const defaults = () => {
  const out: Record<string, Combo[]> = {};
  for (const [id, keys] of Object.entries(defaultBindings())) {
    out[id] = keys.map((k) => parseCombo(k)).filter((k): k is Combo => k !== null);
  }
  return out;
};

const write = (id: string, combos: Combo[]) => {
  const def = defaults()[id] ?? [];
  const same = JSON.stringify(def) === JSON.stringify(combos);
  void setValue(["keys", id], same ? null : combos.length === 0 ? "" : combos);
};

/** Records one shortcut, or a two-step chord if a second key follows quickly. */
function Capture({ onDone }: { onDone: (c: Combo | null) => void }) {
  const [first, setFirst] = useState<Combo | null>(null);
  useEffect(() => {
    let timer = 0;
    let step: Combo | null = null;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isModifierOnly(e)) return;
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        onDone(null);
        return;
      }
      const c = eventCombos(e)[0];
      if (!c) return;
      clearTimeout(timer);
      if (step) {
        onDone(`${step} ${c}`);
        return;
      }
      step = c;
      setFirst(c);
      timer = window.setTimeout(() => onDone(step), 900);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onDone]);
  return (
    <span className="key-capture">{first ? `${formatCombo(first)} …` : t("Press keys…")}</span>
  );
}

export function KeysSection() {
  const bindings = useBindings();
  const [query, setQuery] = useState("");
  const [capturing, setCapturing] = useState<string | null>(null);
  const conflicts = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of findConflicts(bindings)) {
      for (const a of c.actions)
        m.set(a, [...(m.get(a) ?? []), ...c.actions.filter((x) => x !== a)]);
    }
    return m;
  }, [bindings]);
  const defs = useMemo(() => defaults(), []);
  const list = fuzzyFilter([...actions], query, (a) => `${actionLabel(a)} ${a.id}`);

  return (
    <>
      <input
        className="text keys-search"
        placeholder={t("Search shortcuts")}
        value={query}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
      />
      {GROUPS.map((g) => {
        const items = list.filter((a) => a.group === g);
        if (!items.length) return null;
        return (
          <div key={g} className="keys-group">
            <div className="set-group-title">{t(g)}</div>
            {items.map((a) => {
              const combos = bindings[a.id] ?? [];
              const changed = JSON.stringify(combos) !== JSON.stringify(defs[a.id] ?? []);
              const clash = conflicts.get(a.id);
              return (
                <div key={a.id} className="set-row key-row">
                  <span className="set-label">
                    {actionLabel(a)}
                    {clash && (
                      <span className="key-clash">
                        {t("Also")}:{" "}
                        {[...new Set(clash)]
                          .map((id) => actions.find((x) => x.id === id))
                          .filter(Boolean)
                          .map((x) => actionLabel(x!))
                          .join(", ")}
                      </span>
                    )}
                  </span>
                  <span className="set-control">
                    {combos.map((c) => (
                      <span key={c} className="chip key">
                        {formatCombo(c)}
                        <button
                          className="chip-x"
                          onClick={() =>
                            write(
                              a.id,
                              combos.filter((x) => x !== c),
                            )
                          }
                        >
                          <X size={10} strokeWidth={1.5} />
                        </button>
                      </span>
                    ))}
                    {capturing === a.id ? (
                      <Capture
                        onDone={(c) => {
                          setCapturing(null);
                          if (c && !combos.includes(c)) write(a.id, [...combos, c]);
                        }}
                      />
                    ) : (
                      <button
                        className="icon-btn"
                        onClick={() => setCapturing(a.id)}
                        title={t("Add shortcut")}
                      >
                        <Plus size={12} strokeWidth={1.5} />
                      </button>
                    )}
                    {changed && (
                      <button
                        className="icon-btn"
                        onClick={() => void setValue(["keys", a.id], null)}
                        title={t("Reset")}
                      >
                        <RotateCcw size={12} strokeWidth={1.5} />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
