// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite-plus";
import {
  beginBuildInputCapture,
  buildInputPlugin,
  digestBuildInput,
  finishBuildInputCapture,
  provenancedPackageRoots,
  readValidatedBuildInputs,
  type BuildInputBinding,
  type BuildPhase,
} from "./build-inputs";

const temporary: string[] = [];
const previousRunDir = process.env.PALOT_BUILD_INPUTS_RUN_DIR;
afterEach(() => {
  if (previousRunDir === undefined) delete process.env.PALOT_BUILD_INPUTS_RUN_DIR;
  else process.env.PALOT_BUILD_INPUTS_RUN_DIR = previousRunDir;
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "palot-build-inputs-"));
  temporary.push(repository);
  const appRoot = path.join(repository, "apps/desktop");
  const source = path.join(appRoot, "src");
  function write(relative: string, contents: string) {
    const file = path.join(repository, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return file;
  }
  write("bun.lock", "fixture-lock");
  write("apps/desktop/package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
  write("apps/desktop/src/index.html", '<script type="module" src="./entry.js"></script>');
  write(
    "apps/desktop/src/entry.js",
    `
    import value from "shipped";
    import { unused } from "shipped/unused.js";
    import "./style.css";
    import virtual from "virtual:fixture";
    import wasm from "./fixture.wasm?url";
    console.log(value, virtual, wasm);
    new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  `,
  );
  write("apps/desktop/src/worker.js", 'import value from "worker-only"; postMessage(value);');
  write("apps/desktop/src/main.js", 'import fs from "node:fs"; console.log(fs);');
  write("apps/desktop/src/preload.js", 'import electron from "electron"; console.log(electron);');
  write(
    "apps/desktop/src/style.css",
    '@import "css-only/styles.css"; @font-face { font-family: fixture; src: url("./fixture.woff2"); } body {font-family: fixture}',
  );
  write("apps/desktop/src/fixture.woff2", "font fixture");
  write("apps/desktop/src/fixture.wasm", "wasm fixture");
  for (const name of ["shipped", "worker-only", "css-only", "build-tool-only"]) {
    write(
      `apps/desktop/node_modules/${name}/package.json`,
      JSON.stringify({ name, version: "1.0.0", main: "index.js", sideEffects: false }),
    );
    write(`apps/desktop/node_modules/${name}/index.js`, `export default ${JSON.stringify(name)};`);
  }
  write("apps/desktop/node_modules/css-only/styles.css", "body {color: green}");
  const unused = write(
    "apps/desktop/node_modules/shipped/unused.js",
    "export const unused = 'tree shaken';",
  );
  const binding: BuildInputBinding = {
    commit: "fixture-commit",
    channel: "nightly",
    version: "1.0.0-nightly.1",
    buildInfoJson: '{"version":"1.0.0-nightly.1"}',
    lockfile: digestBuildInput(path.join(repository, "bun.lock")),
  };
  const phases: BuildPhase[] = ["main", "preload", "renderer"];
  const runDir = beginBuildInputCapture(appRoot, phases, binding);
  process.env.PALOT_BUILD_INPUTS_RUN_DIR = runDir;
  async function compile(workerCapture = true, assetsInlineLimit = 0) {
    for (const phase of phases) {
      await build({
        configFile: false,
        root: source,
        logLevel: "silent",
        publicDir: false,
        plugins: [
          buildInputPlugin(phase),
          {
            name: "fixture-virtual-module",
            resolveId(id) {
              if (id === "virtual:fixture") return "\0fixture";
            },
            load(id) {
              if (id === "\0fixture") return 'export default "virtual";';
            },
          },
        ],
        worker: {
          format: "es",
          plugins: () => (workerCapture ? [buildInputPlugin("renderer", true)] : []),
        },
        build: {
          outDir: path.join(appRoot, "out", phase),
          emptyOutDir: true,
          assetsInlineLimit,
          sourcemap: true,
          ...(phase === "renderer"
            ? {}
            : {
                lib: {
                  entry: path.join(source, `${phase}.js`),
                  formats: ["es"] as ["es"],
                  fileName: "index",
                },
              }),
          rollupOptions: { external: ["electron", "node:fs"] },
        },
      });
    }
  }
  return { repository, appRoot, runDir, binding, compile, unused, write };
}

describe("artifact build input provenance", () => {
  it.each(["preact", "@fixture/preact"])(
    "attributes %s export entrypoints to their installed package owner",
    async (name) => {
      const f = fixture();
      const installed = `apps/desktop/node_modules/react-scan/node_modules/${name}`;
      const rootMetadata = f.write(
        `${installed}/package.json`,
        JSON.stringify({ name, version: "10.0.0", license: "MIT" }),
      );
      f.write(`${installed}/LICENSE`, "Root package license text");
      for (const entry of ["compat", "hooks", "jsx-runtime"]) {
        f.write(
          `${installed}/${entry}/package.json`,
          JSON.stringify({ name: `${name}/${entry}`, version: "10.0.0", main: "index.js" }),
        );
        f.write(`${installed}/${entry}/index.js`, `console.log(${JSON.stringify(entry)});`);
        fs.appendFileSync(
          path.join(f.appRoot, "src/entry.js"),
          `\nimport "../node_modules/react-scan/node_modules/${name}/${entry}/index.js";`,
        );
      }
      await f.compile();
      const packages = provenancedPackageRoots(finishBuildInputCapture(f.runDir));
      const owners = packages.filter((pkg) => pkg.name.startsWith(name));
      expect(owners).toEqual([
        {
          root: path.dirname(rootMetadata),
          name,
          version: "10.0.0",
          metadata: digestBuildInput(rootMetadata),
        },
      ]);
      expect(fs.readFileSync(path.join(owners[0]!.root, "LICENSE"), "utf8")).toBe(
        "Root package license text",
      );
    },
  );

  it("rejects a missing installation manifest instead of adopting a subpath manifest", async () => {
    const f = fixture();
    const installed = "apps/desktop/node_modules/root-missing";
    f.write(
      `${installed}/compat/package.json`,
      JSON.stringify({ name: "root-missing/compat", version: "1.0.0" }),
    );
    f.write(`${installed}/compat/index.js`, "console.log('compat');");
    fs.appendFileSync(
      path.join(f.appRoot, "src/entry.js"),
      '\nimport "../node_modules/root-missing/compat/index.js";',
    );
    await expect(f.compile()).rejects.toThrow(/root-missing[/\\]package\.json/);
    expect(() => readValidatedBuildInputs(f)).toThrow();
  });

  it("captures loaded and tree-shaken code, worker-only packages, virtual IDs and original assets", async () => {
    const f = fixture();
    await f.compile();
    finishBuildInputCapture(f.runDir);
    const manifest = readValidatedBuildInputs(f);
    expect(provenancedPackageRoots(manifest).map((pkg) => pkg.name)).toEqual(
      expect.arrayContaining(["shipped", "worker-only", "css-only"]),
    );
    expect(provenancedPackageRoots(manifest).map((pkg) => pkg.name)).not.toContain(
      "build-tool-only",
    );
    const inputs = manifest.captures.flatMap((capture) =>
      capture.inputs.map((input) => input.path),
    );
    expect(inputs).toContain(f.unused);
    expect(inputs).toEqual(
      expect.arrayContaining([
        path.join(f.appRoot, "src/fixture.woff2"),
        path.join(f.appRoot, "src/fixture.wasm"),
        path.join(f.appRoot, "src/style.css"),
      ]),
    );
    expect(manifest.captures.flatMap((capture) => capture.virtualModules)).toContain("\0fixture");
    expect(manifest.captures.flatMap((capture) => capture.externals)).toEqual(
      expect.arrayContaining(["electron", "node:fs"]),
    );
    expect(
      manifest.captures.some(
        (capture) => capture.worker && capture.packages.some((pkg) => pkg.name === "worker-only"),
      ),
    ).toBe(true);
    expect(manifest.outputs.length).toBeGreaterThan(7);
    fs.writeFileSync(path.join(f.appRoot, "out", manifest.outputs[0]!.path), "tampered output");
    expect(() => readValidatedBuildInputs(f)).toThrow("hash mismatch");
  });

  it("rejects an uninstrumented worker even though Vite emitted its output", async () => {
    const f = fixture();
    await f.compile(false);
    expect(() => finishBuildInputCapture(f.runDir)).toThrow("Missing worker build capture");
  });

  it("keeps CSS font and WASM provenance when Vite inlines their bytes", async () => {
    const f = fixture();
    await f.compile(true, 10000);
    const manifest = finishBuildInputCapture(f.runDir);
    const inputs = manifest.captures.flatMap((capture) =>
      capture.inputs.map((input) => input.path),
    );
    expect(inputs).toContain(path.join(f.appRoot, "src/fixture.woff2"));
    expect(inputs).toContain(path.join(f.appRoot, "src/fixture.wasm"));
    expect(manifest.outputs.some((output) => /\.(woff2|wasm)$/.test(output.path))).toBe(false);
  });

  it("fails closed for CSS forced-inline assets that bypass Vite's provenance hooks", async () => {
    const f = fixture();
    fs.appendFileSync(
      path.join(f.appRoot, "src/style.css"),
      '\nbody { background: url("./fixture.woff2?inline"); }',
    );
    await expect(f.compile()).rejects.toThrow(
      "CSS asset mode has no authoritative provenance hook",
    );
    expect(() => readValidatedBuildInputs(f)).toThrow();
  });

  it("rejects missing real inputs, modified metadata, stale identity, lockfile, and partial generations", async () => {
    const f = fixture();
    await f.compile();
    finishBuildInputCapture(f.runDir);
    expect(() =>
      readValidatedBuildInputs({ ...f, binding: { ...f.binding, commit: "other" } }),
    ).toThrow("identity");
    const metadata = path.join(f.appRoot, "node_modules/shipped/package.json");
    const original = fs.readFileSync(metadata);
    fs.writeFileSync(metadata, JSON.stringify({ name: "shipped", version: "2.0.0" }));
    expect(() => readValidatedBuildInputs(f)).toThrow("hash mismatch");
    fs.writeFileSync(metadata, original);
    fs.unlinkSync(f.unused);
    expect(() => readValidatedBuildInputs(f)).toThrow();
    fs.writeFileSync(f.unused, "export const unused = 'tree shaken';");
    fs.writeFileSync(path.join(f.repository, "bun.lock"), "changed lock");
    expect(() => readValidatedBuildInputs(f)).toThrow("hash mismatch");
    fs.writeFileSync(path.join(f.repository, "bun.lock"), "fixture-lock");
    const missingPhase = fs.readdirSync(f.runDir).find((file) => file.startsWith("preload-"))!;
    fs.unlinkSync(path.join(f.runDir, missingPhase));
    expect(() => finishBuildInputCapture(f.runDir)).toThrow("Missing or duplicate build phase");
    beginBuildInputCapture(f.appRoot, ["renderer"], f.binding);
    expect(() => readValidatedBuildInputs(f)).toThrow("Stale build input generation");
    expect(() => readValidatedBuildInputs({ appRoot: f.appRoot, binding: f.binding })).toThrow();
  });
});
