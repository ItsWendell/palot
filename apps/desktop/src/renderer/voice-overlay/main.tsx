/** Entry for the floating voice overlay window. It only talks to `window.palotVoiceOverlay`. */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VoiceOverlay } from "./voice-overlay";
import "../index.css";
import "./voice-overlay.css";

const root = document.getElementById("root");
const api = window.palotVoiceOverlay;
if (!root || !api) throw new Error("Voice overlay bridge is unavailable");

const documentRoot = document.documentElement;
documentRoot.dataset.platform = api.platform;
// Main applies the app's light/dark mode through nativeTheme, which drives this query.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyScheme = () => {
  documentRoot.dataset.resolvedTheme = dark.matches ? "dark" : "light";
};
applyScheme();
dark.addEventListener("change", applyScheme);

createRoot(root).render(
  <StrictMode>
    <VoiceOverlay api={api} />
  </StrictMode>,
);
