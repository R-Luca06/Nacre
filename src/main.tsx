import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { bootstrap } from "./app/bootstrap";

void bootstrap().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
});
