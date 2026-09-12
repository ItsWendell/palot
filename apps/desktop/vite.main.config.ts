import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAIN_EXTERNALS = new Set([
  "electron",
  "electron-liquid-glass",
  "electron-log",
  "electron-store",
  "objc-js",
]);

function isExternal(id: string): boolean {
  return (
    id === "node:sqlite" ||
    isBuiltin(id) ||
    MAIN_EXTERNALS.has(id) ||
    id.startsWith("electron/") ||
    id.startsWith("electron-log/")
  );
}

export default defineConfig({
  define: {
    __PALOT_BUILD_CHANNEL__: JSON.stringify(process.env.PALOT_BUILD_CHANNEL ?? "stable"),
  },
  build: {
    target: "node24",
    outDir: path.join(APP_ROOT, "out/main"),
    emptyOutDir: true,
    minify: false,
    sourcemap: process.env.PALOT_RELEASE_BUILD === "1" ? "hidden" : true,
    lib: {
      entry: path.join(APP_ROOT, "src/main/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: isExternal,
    },
  },
});
