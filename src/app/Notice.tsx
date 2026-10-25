import { useState } from "react";
import { X } from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useConfig } from "../store/config";

/** Config problems, one line each. Clicking opens the file. */
export function Notice() {
  const errors = useConfig((s) => s.errors);
  const extra = useConfig((s) => s.extraErrors);
  const path = useConfig((s) => s.path);
  const all = [...errors, ...extra];
  const key = all.join("\n");
  const [dismissed, setDismissed] = useState("");
  if (!all.length || dismissed === key) return null;
  return (
    <div className="notice popover">
      <button className="notice-body" onClick={() => path && void openPath(path)}>
        {all.slice(0, 4).map((e) => (
          <div key={e}>{e}</div>
        ))}
        {all.length > 4 && <div>+{all.length - 4}</div>}
      </button>
      <button className="icon-btn" onClick={() => setDismissed(key)}>
        <X size={12} strokeWidth={1.5} />
      </button>
    </div>
  );
}
