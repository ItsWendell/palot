import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Showcase } from "./showcase";
import "./showcase.css";

// Shortcut labels (⌘ or Ctrl) follow the platform, as in the app.
document.documentElement.dataset.platform = navigator.platform.startsWith("Mac")
  ? "darwin"
  : "linux";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
const root = document.documentElement;
root.dataset.appearance = theme;
root.dataset.resolvedTheme = theme;
root.style.colorScheme = theme;
if (params.get("motion") === "reduced") root.dataset.reducedMotion = "true";

const element = document.getElementById("root");
if (!element) throw new Error("Showcase root is missing");

createRoot(element).render(
  <StrictMode>
    <Showcase />
  </StrictMode>,
);
