import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "js/index.ts",
  format: ["cjs", "esm"],
  // Match package.json's require/import exports, independent of package type.
  fixedExtension: true,
  dts: false,
  clean: true,
  outDir: "dist",
  target: "node18",
  platform: "node",
  tsconfig: "tsconfig.build.json",
  deps: {
    neverBundle: ["bindings", "node-addon-api", "node-gyp-build", "electron"],
  },
});
