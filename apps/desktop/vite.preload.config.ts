import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { buildInputPlugin } from "./scripts/build-inputs";

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_MODULES = new Set(builtinModules);

export default defineConfig({
  plugins: [buildInputPlugin("preload")],
  build: {
    target: "node24",
    outDir: path.join(APP_ROOT, "out/preload"),
    emptyOutDir: true,
    minify: false,
    sourcemap: process.env.PALOT_RELEASE_BUILD === "1" ? "hidden" : true,
    lib: {
      entry: {
        index: path.join(APP_ROOT, "src/preload/index.ts"),
      },
      formats: ["cjs"],
      fileName: (_format, entryName) => `${entryName}.cjs`,
    },
    rollupOptions: {
      external: (id) => {
        const normalized = id.replace(/^node:/, "");
        return id === "electron" || BUILTIN_MODULES.has(normalized);
      },
    },
  },
});
