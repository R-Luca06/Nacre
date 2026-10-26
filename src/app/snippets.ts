import { t } from "../i18n";
import { activeTab, useWorkspace } from "../store/workspace";
import { getSession } from "../terminal/registry";
import { setValue } from "../settings/fields";

/** Asks a name, then stores the last command under [snippets]. */
export function saveLastAsSnippet() {
  const ws = useWorkspace.getState();
  const id = activeTab()?.active;
  const b = id ? getSession(id)?.commands.lastFinished() : undefined;
  if (!b?.command) {
    ws.showToast(t("No command to save yet."), "warn");
    return;
  }
  const command = b.command;
  ws.setOverlay({
    kind: "prompt",
    prompt: {
      title: t("Save Last Command as Snippet"),
      placeholder: t("Name"),
      value: command.split(" ")[0],
      action: t("Save"),
      onSubmit: (name) => void setValue(["snippets", name], command),
    },
  });
}
