import path from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import reactComponentName from "react-scan/react-component-name/vite";
import { defineConfig } from "vite-plus";
import { buildInfoDefine } from "./scripts/release-build-info";

type VitePlusConfig = Exclude<
  Parameters<typeof defineConfig>[0],
  ((...args: never[]) => unknown) | Promise<unknown>
>;
type VitePlusPlugin = NonNullable<VitePlusConfig["plugins"]>[number];

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_ROOT = path.join(APP_ROOT, "src/renderer");
const reactCompilerMode = compilerMode(process.env.PALOT_REACT_COMPILER);
const useReactProfilingBuild = process.env.PALOT_REACT_PROFILING === "1";
const useReactScanByDefault = process.env.PALOT_REACT_SCAN === "1";
const usePerformanceHarness = process.env.PALOT_PERFORMANCE_HARNESS === "1";

function compilerMode(value: string | undefined): "annotation" | "infer" | null {
  if (!value) return null;
  if (value === "annotation" || value === "infer") return value;
  throw new Error(`Unsupported PALOT_REACT_COMPILER mode '${value}'`);
}

// Vite ecosystem plugins still publish Vite's Plugin type while Vite+ exposes its
// equivalent core type. Keep that compatibility boundary local to this config.
function vitePlusPlugins(...plugins: unknown[]): VitePlusPlugin[] {
  return plugins as VitePlusPlugin[];
}

export default defineConfig({
  root: RENDERER_ROOT,
  base: "./",
  plugins: vitePlusPlugins(
    tanstackRouter({
      target: "react",
      routesDirectory: path.join(RENDERER_ROOT, "routes"),
      generatedRouteTree: path.join(RENDERER_ROOT, "routeTree.gen.ts"),
      autoCodeSplitting: true,
      quoteStyle: "double",
      semicolons: true,
      routeTreeFileHeader: ["// @ts-nocheck", "// noinspection JSUnusedGlobalSymbols"],
    }),
    useReactScanByDefault
      ? reactComponentName({ include: /src\/renderer\/.*\.[tj]sx?$/ })
      : undefined,
    react(),
    reactCompilerMode
      ? babel({ presets: [reactCompilerPreset({ compilationMode: reactCompilerMode })] })
      : undefined,
    tailwindcss(),
  ),
  define: {
    __PALOT_BUILD_CHANNEL__: JSON.stringify(process.env.PALOT_BUILD_CHANNEL ?? "stable"),
    __PALOT_RELEASE_BUILD_INFO__: buildInfoDefine(),
    __PALOT_REACT_PROFILING__: JSON.stringify(useReactProfilingBuild),
    __PALOT_REACT_COMPILER_MODE__: JSON.stringify(reactCompilerMode),
    __PALOT_REACT_SCAN_DEFAULT__: JSON.stringify(useReactScanByDefault),
    __PALOT_PERFORMANCE_HARNESS__: JSON.stringify(usePerformanceHarness),
  },
  resolve: {
    alias: {
      "@": RENDERER_ROOT,
      ...(useReactProfilingBuild ? { "react-dom/client": "react-dom/profiling" } : {}),
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PALOT_RENDERER_PORT ?? 1420),
    strictPort: true,
  },
  worker: {
    format: "es",
  },
  build: {
    target: "chrome144",
    ...(useReactScanByDefault ? { minify: false } : {}),
    cssMinify: false,
    outDir: path.join(APP_ROOT, "out/renderer"),
    emptyOutDir: true,
    sourcemap: process.env.PALOT_RELEASE_BUILD === "1" ? "hidden" : true,
    rollupOptions: {
      input: {
        main: path.join(RENDERER_ROOT, "index.html"),
      },
    },
  },
});
