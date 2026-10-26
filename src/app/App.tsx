import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWorkspace } from "../store/workspace";
import { TabView } from "../layout/TabView";
import { Palette } from "../palette/Palette";
import { SnippetDialog } from "../palette/SnippetDialog";
import { TabBar } from "./TabBar";
import { ConfirmDialog } from "./ConfirmDialog";
import { Notice } from "./Notice";
import { Toast } from "./Toast";
import { Overview } from "./Overview";
import { CommandEditor } from "../terminal/CommandEditor";
import { PromptDialog } from "./PromptDialog";
import { Settings } from "../settings/Settings";
import { Dashboard } from "../claude/Dashboard";
import { ClaudePanel, DiffView } from "../claude/Panel";
import { FilterView } from "../terminal/FilterView";
import { ChatPanel } from "../ai/ChatPanel";
import { StatusBar } from "../statusbar/StatusBar";
import { useConfig } from "../store/config";
import "./app.css";

function useFullscreen() {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const win = getCurrentWindow();
    const check = () => void win.isFullscreen().then(setFull);
    check();
    const un = win.onResized(check);
    return () => void un.then((f) => f());
  }, []);
  return full;
}

export function App() {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const overlay = useWorkspace((s) => s.overlay);
  const panel = useWorkspace((s) => s.panel);
  const fullscreen = useFullscreen();
  const sb = useConfig((s) => s.config.statusbar);
  const windowBar = sb.enabled && sb.scope === "window";
  const vertical = useConfig((s) => s.config.window.tabs === "left");

  return (
    <div className="window">
      {!vertical && <TabBar fullscreen={fullscreen} />}
      {windowBar && sb.position === "top" && <StatusBar />}
      <div className="main">
        {vertical && <TabBar fullscreen={fullscreen} vertical />}
        <div className="workspace">
          {tabs.map((tab) => (
            <TabView key={tab.id} tab={tab} visible={tab.id === activeTabId} />
          ))}
          {overlay?.kind === "palette" && (
            <Palette key={overlay.mode ?? "commands"} mode={overlay.mode} />
          )}
          {overlay?.kind === "snippet" && (
            <SnippetDialog name={overlay.name} template={overlay.template} run={overlay.run} />
          )}
          {overlay?.kind === "confirm" && <ConfirmDialog confirm={overlay.confirm} />}
          {overlay?.kind === "prompt" && <PromptDialog prompt={overlay.prompt} />}
          {overlay?.kind === "settings" && <Settings />}
          {overlay?.kind === "overview" && <Overview />}
          {overlay?.kind === "editor" && (
            <CommandEditor paneId={overlay.paneId} text={overlay.text} />
          )}
          {overlay?.kind === "claude" && (
            <Dashboard key={overlay.view ?? "sessions"} initial={overlay.view} />
          )}
          {overlay?.kind === "diff" && <DiffView path={overlay.path} cwd={overlay.cwd} />}
          {overlay?.kind === "filter" && (
            <FilterView paneId={overlay.paneId} blockId={overlay.blockId} />
          )}
          <Notice />
          <Toast />
        </div>
        {panel === "claude" && <ClaudePanel />}
        {panel === "chat" && <ChatPanel />}
      </div>
      {windowBar && sb.position === "bottom" && <StatusBar />}
    </div>
  );
}
