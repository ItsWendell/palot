import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite-plus";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("packaged preload bundles", () => {
  it("keeps every sandboxed preload self-contained", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "palot-preload-"));
    try {
      await build({
        configFile: path.join(APP_ROOT, "vite.preload.config.ts"),
        logLevel: "silent",
        build: { outDir, emptyOutDir: true },
      });

      for (const file of ["index.cjs"]) {
        const source = await readFile(path.join(outDir, file), "utf8");
        expect(source, `${file} must not require sibling chunks`).not.toMatch(
          /require\(["']\.\.?\//,
        );
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
