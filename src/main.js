import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { AppStateProvider } from "./context/AppStateContext";

// Suppress ResizeObserver loop errors (as in the Training Manager site)
const resizeObserverLoopErr = "ResizeObserver loop completed with undelivered notifications.";
const originalError = window.console.error;
window.console.error = (...args) => {
  if (typeof args[0] === "string" && args[0].includes(resizeObserverLoopErr)) return;
  originalError.call(window.console, ...args);
};
window.addEventListener("error", (e) => {
  if (e.message === resizeObserverLoopErr) e.stopImmediatePropagation();
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </React.StrictMode>
);
