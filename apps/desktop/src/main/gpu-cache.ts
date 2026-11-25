import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import log from "electron-log/main";

const GPU_CACHE_DIRECTORIES = [
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
] as const;
const MARKER_FILE = "gpu-cache-electron-version";

function readMarker(markerPath: string): string | undefined {
  try {
    return readFileSync(markerPath, "utf8").trim();
  } catch {
    return undefined;
  }
}

/**
 * Removes Chromium's GPU and shader caches when they were written by another Electron build.
 * Nothing in Chromium invalidates them across Electron updates, and stale ones paint scroll areas
 * and icons blank. Keyed on Electron rather than Chromium because Electron patches ship Chromium
 * backports under the same Chrome version. Chromium opens these caches at the first event-loop
 * turn, so this must run synchronously before then.
 */
export function clearStaleGpuCaches(input: { userData: string; electronVersion: string }): void {
  const markerPath = path.join(input.userData, MARKER_FILE);
  if (readMarker(markerPath) === input.electronVersion) return;
  try {
    for (const name of GPU_CACHE_DIRECTORIES) {
      rmSync(path.join(input.userData, name), { recursive: true, force: true });
    }
    mkdirSync(input.userData, { recursive: true });
    writeFileSync(markerPath, input.electronVersion);
  } catch (error) {
    // Without the marker the next launch tries again.
    log.warn("Could not clear stale GPU caches", { userData: input.userData, error });
  }
}
