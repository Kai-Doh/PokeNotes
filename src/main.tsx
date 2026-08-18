import React from "react";
import ReactDOM from "react-dom/client";
import * as tauriLog from "@tauri-apps/plugin-log";
import App from "./App";

// attachConsole() only forwards Rust-side logs into the webview console (the
// opposite direction). To see our console.* calls in the terminal, forward
// them to the log plugin explicitly.
const origLog = console.log;
const origError = console.error;
console.log = (...args: unknown[]) => {
  origLog(...args);
  tauriLog.info(args.map(String).join(" "));
};
console.error = (...args: unknown[]) => {
  origError(...args);
  tauriLog.error(args.map(String).join(" "));
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
