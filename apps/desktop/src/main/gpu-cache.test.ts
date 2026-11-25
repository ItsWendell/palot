// @vitest-environment node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log/main", () => ({ default: { warn: vi.fn() } }));

import { clearStaleGpuCaches } from "./gpu-cache";

const CACHES = [
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
];

describe("clearing stale GPU caches", () => {
  let userData: string;

  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), "palot-gpu-cache-"));
    for (const name of CACHES) {
      mkdirSync(path.join(userData, name));
      writeFileSync(path.join(userData, name, "data_0"), "shaders");
    }
    mkdirSync(path.join(userData, "Local Storage"));
    writeFileSync(path.join(userData, "Local Storage", "LOCK"), "profile");
    writeFileSync(path.join(userData, "palot-settings.json"), "{}");
  });

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true });
  });

  const surviving = () => CACHES.filter((name) => existsSync(path.join(userData, name)));
  const marker = () => readFileSync(path.join(userData, "gpu-cache-electron-version"), "utf8");

  it("clears caches with no recorded Electron version and records the current one", () => {
    clearStaleGpuCaches({ userData, electronVersion: "45.2.3" });

    expect(surviving()).toEqual([]);
    expect(marker()).toBe("45.2.3");
  });

  it("keeps caches written by the same Electron version", () => {
    writeFileSync(path.join(userData, "gpu-cache-electron-version"), "45.2.3\n");

    clearStaleGpuCaches({ userData, electronVersion: "45.2.3" });

    expect(surviving()).toEqual(CACHES);
  });

  it("clears caches written by another Electron version once", () => {
    writeFileSync(path.join(userData, "gpu-cache-electron-version"), "45.1.0");

    clearStaleGpuCaches({ userData, electronVersion: "45.2.3" });
    expect(surviving()).toEqual([]);
    expect(marker()).toBe("45.2.3");

    mkdirSync(path.join(userData, "GPUCache"));
    clearStaleGpuCaches({ userData, electronVersion: "45.2.3" });
    expect(surviving()).toEqual(["GPUCache"]);
  });

  it("leaves unrelated profile data alone", () => {
    clearStaleGpuCaches({ userData, electronVersion: "45.2.3" });

    expect(readFileSync(path.join(userData, "Local Storage", "LOCK"), "utf8")).toBe("profile");
    expect(readFileSync(path.join(userData, "palot-settings.json"), "utf8")).toBe("{}");
  });

  it("creates userData on a fresh install so the first caches are kept", () => {
    const fresh = path.join(userData, "fresh");

    clearStaleGpuCaches({ userData: fresh, electronVersion: "45.2.3" });

    expect(readFileSync(path.join(fresh, "gpu-cache-electron-version"), "utf8")).toBe("45.2.3");
  });
});
