import "./statusbar/segments";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { bootstrap } from "./app/bootstrap";

const errors: string[] = [];
if (import.meta.env.DEV) {
  Object.assign(window, { __errors: errors });
  window.addEventListener("error", (e) => errors.push(String(e.error?.stack ?? e.message)));
  window.addEventListener("unhandledrejection", (e) =>
    errors.push(String(e.reason?.stack ?? e.reason)),
  );
}

const render = () =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement, {
    onUncaughtError: (e) => errors.push(String((e as Error)?.stack ?? e)),
  }).render(<App />);

bootstrap().then(render, (e) => {
  errors.push(String(e?.stack ?? e));
  render();
});
