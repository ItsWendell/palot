// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyLiquidGlassExports } from "./native-module-exports";

describe("packaged Liquid Glass module exports", () => {
  it("loads both module conditions and rejects missing or incompatible entrypoints", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "palot-native-exports-"));
    const manifest = {
      name: "electron-liquid-glass",
      type: "module",
      exports: { ".": { import: "./dist/index.mjs", require: "./dist/index.cjs" } },
    };
    const api = "({ addView() {}, removeView() {}, isGlassSupported() {}, setAppearance() {} })";
    try {
      await mkdir(path.join(directory, "dist"));
      await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest));
      await writeFile(path.join(directory, "dist/index.mjs"), `export default ${api}`);
      await writeFile(path.join(directory, "dist/index.cjs"), `module.exports = ${api}`);
      await expect(verifyLiquidGlassExports(directory)).resolves.toBeUndefined();
      manifest.exports["."].import = "./dist/index.js";
      await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest));
      await expect(verifyLiquidGlassExports(directory)).rejects.toThrow("index.js");
      manifest.exports["."].import = "./dist/index.mjs";
      await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest));
      await writeFile(path.join(directory, "dist/index.cjs"), "module.exports = {}");
      await expect(verifyLiquidGlassExports(directory)).rejects.toThrow("require lacks addView");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
