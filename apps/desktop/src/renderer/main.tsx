import { Profiler, StrictMode, type ProfilerOnRenderCallback } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/dm-sans/wght-italic.css";
import "@fontsource-variable/dm-sans/wght.css";
import "@fontsource-variable/fira-code/wght.css";
import "@fontsource-variable/geist/wght-italic.css";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght-italic.css";
import "@fontsource-variable/geist-mono/wght.css";
import "@fontsource-variable/ibm-plex-sans/wght-italic.css";
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "@fontsource-variable/inter/wght-italic.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import { App } from "./app";
import { palotBuild } from "./lib/build";
import { batchProcessingProbe } from "./lib/batch-processing-probe";
import { applyAppearanceToRoot } from "./lib/appearance";
import { hydrateAppearancePreferencesAtom, resolvedAppearanceAtom } from "./atoms/appearance";
import { rendererStore } from "./router";
import { prepareAppearanceFonts } from "./lib/font-loading";
import {
  setStreamingLatencyCollectionSource,
  streamingLatencyCursor,
  streamingLatencySamples,
  streamingLatencySamplesSince,
} from "./lib/streaming-latency";
import {
  readDiagnosticsStatus,
  startOptionalDiagnosticsOverlayHost,
} from "./lib/diagnostics-runtime";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Renderer root is missing");

document.documentElement.dataset.platform =
  window.palot?.platform ??
  (navigator.platform.startsWith("Mac")
    ? "darwin"
    : navigator.platform.toLowerCase().includes("linux")
      ? "linux"
      : "browser");
document.documentElement.dataset.buildChannel = palotBuild.channel;
document.title = palotBuild.displayName;

if (__PALOT_PERFORMANCE_HARNESS__) {
  if (batchProcessingProbe) {
    window.palotBatchProcessing = {
      start: batchProcessingProbe.start,
      stop: batchProcessingProbe.stop,
    };
  }
  setStreamingLatencyCollectionSource("harness", true);
  window.palotStreamingLatency = streamingLatencySamples;
  window.palotStreamingLatencyWindow = {
    cursor: streamingLatencyCursor,
    samplesSince: streamingLatencySamplesSince,
  };
}

const reactProfilerSamples: PalotReactProfilerSample[] = [];
const recordReactRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) => {
  if (reactProfilerSamples.length >= 1_000) reactProfilerSamples.shift();
  reactProfilerSamples.push({
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  });
};
if (__PALOT_REACT_PROFILING__) {
  window.palotReactProfiler = {
    clear: () => reactProfilerSamples.splice(0),
    samples: () => [...reactProfilerSamples],
  };
}

const application = __PALOT_REACT_PROFILING__ ? (
  <Profiler id="Palot" onRender={recordReactRender}>
    <App />
  </Profiler>
) : (
  <App />
);

async function startRenderer() {
  // A renderer reload reuses BrowserWindow additionalArguments. Read main's
  // current snapshot before painting or mounting the write-through appearance sync.
  const snapshot = await window.palot?.loadAppearance();
  if (snapshot) rendererStore.set(hydrateAppearancePreferencesAtom, snapshot);
  document.documentElement.dataset.chromeTier = snapshot?.chromeTier ?? "opaque";
  document.documentElement.dataset.reducedTransparency = String(
    snapshot?.reducedTransparency ?? false,
  );
  const appearance = rendererStore.get(resolvedAppearanceAtom);
  void prepareAppearanceFonts(appearance.preferences.uiFont, appearance.preferences.codeFont);
  applyAppearanceToRoot(appearance);
  createRoot(root!).render(<StrictMode>{application}</StrictMode>);
  window.palotDiagnostics = { snapshot: readDiagnosticsStatus };
  startOptionalDiagnosticsOverlayHost();
}

void startRenderer().catch((error) => {
  console.error("[appearance] Could not load appearance", error);
  // Do not mount with stale preferences and accidentally persist them on failure.
  root.setAttribute("role", "alert");
  root.textContent = "Could not load appearance. Reload the window to try again.";
});
