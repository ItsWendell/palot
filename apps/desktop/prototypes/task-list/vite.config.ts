import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

type VitePlusConfig = Exclude<
  Parameters<typeof defineConfig>[0],
  ((...args: never[]) => unknown) | Promise<unknown>
>;
type VitePlusPlugin = NonNullable<VitePlusConfig["plugins"]>[number];

// Vite ecosystem plugins publish Vite's Plugin type while Vite+ exposes its equivalent.
function vitePlusPlugins(...plugins: unknown[]): VitePlusPlugin[] {
  return plugins as VitePlusPlugin[];
}

const PROTOTYPE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(PROTOTYPE_ROOT, "../..");
const RENDERER_ROOT = path.join(APP_ROOT, "src/renderer");

// The task list showcase runs in a plain browser: the renderer's React, Tailwind and `@`
// alias, but none of its Electron, router or release plumbing.
export default defineConfig({
  root: PROTOTYPE_ROOT,
  plugins: vitePlusPlugins(react(), tailwindcss()),
  define: {
    __PALOT_E2E__: "false",
    __PALOT_BUILD_CHANNEL__: JSON.stringify("dev"),
    __PALOT_RELEASE_BUILD_INFO__: JSON.stringify({
      version: "0.0.0-prototype",
      commitSha: "prototype",
      buildNumber: "prototype",
      channel: "dev",
      openCodeContractVersion: "0.0.0",
      dirty: true,
    }),
    __PALOT_REACT_PROFILING__: "false",
    __PALOT_REACT_COMPILER_MODE__: "null",
    __PALOT_REACT_SCAN_DEFAULT__: "false",
    __PALOT_PERFORMANCE_HARNESS__: "false",
  },
  resolve: {
    alias: { "@": RENDERER_ROOT },
  },
  server: {
    host: "127.0.0.1",
    port: 5198,
    strictPort: true,
    fs: { allow: [APP_ROOT, path.resolve(APP_ROOT, "../..")] },
  },
});
