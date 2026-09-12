import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import rootPackage from "../../package.json" with { type: "json" };

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [...react()],
  define: {
    __PALOT_BUILD_CHANNEL__: JSON.stringify("dev"),
    __PALOT_RELEASE_BUILD_INFO__: JSON.stringify({
      version: `${rootPackage.version}-test`,
      commitSha: "test-commit",
      buildNumber: "test",
      channel: "dev",
      openCodeContractVersion: "0.0.0-test",
      dirty: true,
    }),
    __PALOT_REACT_PROFILING__: JSON.stringify(false),
    __PALOT_REACT_COMPILER_MODE__: JSON.stringify(null),
    __PALOT_REACT_SCAN_DEFAULT__: JSON.stringify(false),
    __PALOT_PERFORMANCE_HARNESS__: JSON.stringify(false),
  },
  resolve: {
    alias: {
      "@": path.join(APP_ROOT, "src/renderer"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts", "test/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
  },
});
