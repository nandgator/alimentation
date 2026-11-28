// The first stylesheet the bundle meets declares the order of the layers (theme.css), so it comes before the app.
import "./theme.css";
import { must } from "@alimentation/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { registerServiceWorker } from "./pwa.ts";

createRoot(must(document.getElementById("root"))).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerServiceWorker();
