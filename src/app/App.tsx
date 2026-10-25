import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWorkspace } from "../store/workspace";
import { TabView } from "../layout/TabView";
import { Palette } from "../palette/Palette";
import { TabBar } from "./TabBar";
import { ConfirmDialog } from "./ConfirmDialog";
import { Notice } from "./Notice";
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
  const fullscreen = useFullscreen();
  const sb = useConfig((s) => s.config.statusbar);
  const windowBar = sb.enabled && sb.scope === "window";

  return (
    <div className="window">
      <TabBar fullscreen={fullscreen} />
      {windowBar && sb.position === "top" && <StatusBar />}
      <div className="workspace">
        {tabs.map((tab) => (
          <TabView key={tab.id} tab={tab} visible={tab.id === activeTabId} />
        ))}
        {overlay?.kind === "palette" && <Palette />}
        {overlay?.kind === "confirm" && <ConfirmDialog confirm={overlay.confirm} />}
        <Notice />
      </div>
      {windowBar && sb.position === "bottom" && <StatusBar />}
    </div>
  );
}
