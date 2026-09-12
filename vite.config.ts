import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["tools/oxlint/anti-slop/**"],
  },
  lint: {
    ignorePatterns: ["apps/desktop/src/renderer/routeTree.gen.ts", "tools/oxlint/anti-slop/**"],
    jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
    rules: {
      "oxc/no-accumulating-spread": "error",
      "anti-slop/no-reduce-accumulator-copy": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/no-chained-type-assertions": "error",
    },
    overrides: [
      {
        files: ["**/*.{test,spec}.{ts,tsx,js,jsx}", "apps/desktop/test/**"],
        // Partial test doubles intentionally stand in for larger SDK/native objects.
        rules: { "anti-slop/no-chained-type-assertions": "off" },
      },
    ],
    options: {
      // ESLint directives belong to React Doctor and compiler-only profiles; normal lint audits oxlint directives.
      respectEslintDisableDirectives: false,
    },
  },
});
