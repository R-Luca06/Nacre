import { useWorkspace } from "../store/workspace";
import { selectTab } from "./ops";

export function Toast() {
  const toast = useWorkspace((s) => s.toast);
  if (!toast) return null;
  return (
    <button
      key={toast.id}
      className={`toast popover ${toast.level}`}
      onClick={() => {
        if (toast.tabId) selectTab(toast.tabId);
        useWorkspace.setState({ toast: null });
        toast.onClick?.();
      }}
    >
      {toast.text}
    </button>
  );
}
