import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { preprocessCSS, type Plugin, type ResolvedConfig } from "vite-plus";

export type BuildPhase = "main" | "preload" | "renderer";
export interface FileDigest {
  path: string;
  sha256: string;
}
export interface BuildInputPackage {
  root: string;
  name: string;
  version: string;
  metadata: FileDigest;
}
export interface BuildInputBinding {
  commit: string;
  channel: string;
  version: string;
  buildInfoJson: string | null;
  lockfile: FileDigest;
}
interface BuildInputRequest {
  schemaVersion: 1;
  runId: string;
  appRoot: string;
  phases: BuildPhase[];
  binding: BuildInputBinding;
}
export interface BuildInputCapture {
  runId: string;
  id: string;
  phase: BuildPhase;
  worker: boolean;
  complete: boolean;
  inputs: FileDigest[];
  packages: BuildInputPackage[];
  virtualModules: string[];
  externals: string[];
  outputs: string[];
  workerOutputsRequired: string[];
}
export interface BuildInputManifest extends BuildInputRequest {
  captures: BuildInputCapture[];
  outputs: FileDigest[];
}

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function digestBuildInput(file: string): FileDigest {
  const canonical = fs.realpathSync(file);
  if (!fs.statSync(canonical).isFile()) throw new Error(`Build input is not a file: ${file}`);
  return { path: canonical, sha256: sha256(fs.readFileSync(canonical)) };
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, value: unknown): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

export function currentBuildInputBinding(
  appRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): BuildInputBinding {
  const repositoryRoot = path.resolve(appRoot, "../..");
  const buildInfoJson = environment.PALOT_BUILD_INFO_JSON ?? null;
  const info = buildInfoJson ? (JSON.parse(buildInfoJson) as { version?: string }) : null;
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim(),
    channel: environment.PALOT_BUILD_CHANNEL ?? "stable",
    version:
      info?.version ?? readJson<{ version: string }>(path.join(appRoot, "package.json")).version,
    buildInfoJson,
    lockfile: digestBuildInput(path.join(repositoryRoot, "bun.lock")),
  };
}

function storageRoot(appRoot: string): string {
  return path.resolve(appRoot, "../../.local/build-inputs");
}

/** Starts a new generation before any output changes, invalidating the previous latest build. */
export function beginBuildInputCapture(
  appRoot: string,
  phases: BuildPhase[],
  binding = currentBuildInputBinding(appRoot),
): string {
  const runId = randomUUID();
  const runDir = path.join(storageRoot(appRoot), runId);
  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, "request.json"), {
    schemaVersion: 1,
    runId,
    appRoot: path.resolve(appRoot),
    phases,
    binding,
  } satisfies BuildInputRequest);
  writeJson(path.join(storageRoot(appRoot), "latest.json"), { runId });
  return runDir;
}

function filesBelow(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(file);
    if (entry.isFile()) return [file];
    throw new Error(`Unexpected non-regular build output/input: ${file}`);
  });
}

function readPackageOwner(directory: string, required: boolean): BuildInputPackage | undefined {
  const metadataPath = path.join(directory, "package.json");
  let metadata: FileDigest;
  try {
    metadata = digestBuildInput(metadataPath);
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const pkg = readJson<{ name?: string; version?: string }>(metadata.path);
  if (typeof pkg.name === "string" && pkg.name && typeof pkg.version === "string" && pkg.version) {
    return { root: directory, name: pkg.name, version: pkg.version, metadata };
  }
  if (required)
    throw new Error(`Installed package metadata lacks name or version: ${metadataPath}`);
  return undefined;
}

function packageFor(file: string): BuildInputPackage | undefined {
  // Export entrypoints may have their own named package.json without owning the
  // package license. The innermost installation boundary owns all such subpaths.
  const marker = `${path.sep}node_modules${path.sep}`;
  const boundary = file.lastIndexOf(marker);
  if (boundary !== -1) {
    const start = boundary + marker.length;
    const segments = file.slice(start).split(path.sep);
    const packageSegments = segments[0]!.startsWith("@") ? 2 : 1;
    const directory = file.slice(0, start) + segments.slice(0, packageSegments).join(path.sep);
    return readPackageOwner(directory, true);
  }

  // Workspace symlinks have already been canonicalized to their source roots.
  let directory = path.dirname(file);
  while (true) {
    const pkg = readPackageOwner(directory, false);
    if (pkg) return pkg;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** Only filesystem IDs are resolved. Virtual module IDs remain explicit provenance entries. */
export function buildInputFileFromId(id: string): string | null {
  if (id.includes("\0") || !path.isAbsolute(id)) return null;
  return id.replace(/[?#].*$/, "");
}

/** Captures the loaded graph, not just rendered modules, without scanning installed dependencies. */
export function buildInputPlugin(phase: BuildPhase, worker = false): Plugin {
  const runDir = process.env.PALOT_BUILD_INPUTS_RUN_DIR;
  const id = `${phase}${worker ? "-worker" : ""}-${randomUUID()}`;
  let request: BuildInputRequest;
  let root: string;
  let publicDir: string | false = false;
  let resolvedConfig: ResolvedConfig;
  const processedCss = new Set<string>();
  const inputs = new Map<string, FileDigest>();
  const packages = new Map<string, BuildInputPackage>();
  const virtualModules = new Set<string>();
  const externals = new Set<string>();
  const outputs = new Set<string>();
  const workerOutputsRequired = new Set<string>();
  const captureFile = runDir ? path.join(runDir, `${id}.json`) : "";
  function captureFileInput(file: string): void {
    const digest = digestBuildInput(file);
    const previous = inputs.get(digest.path);
    if (previous && previous.sha256 !== digest.sha256) {
      throw new Error(`Build input changed during capture: ${digest.path}`);
    }
    inputs.set(digest.path, digest);
    const pkg = packageFor(digest.path);
    if (pkg) {
      const previousPackage = packages.get(pkg.root);
      if (previousPackage && previousPackage.metadata.sha256 !== pkg.metadata.sha256) {
        throw new Error(`Package metadata changed during capture: ${pkg.root}`);
      }
      packages.set(pkg.root, pkg);
    }
  }
  function captureId(moduleId: string): void {
    const file = buildInputFileFromId(moduleId);
    if (file) captureFileInput(file);
    else virtualModules.add(moduleId);
  }
  function save(complete: boolean): void {
    writeJson(captureFile, {
      runId: request.runId,
      id,
      phase,
      worker,
      complete,
      inputs: [...inputs.values()],
      packages: [...packages.values()],
      virtualModules: [...virtualModules].sort(),
      externals: [...externals].sort(),
      outputs: [...outputs].sort(),
      workerOutputsRequired: [...workerOutputsRequired].sort(),
    } satisfies BuildInputCapture);
  }
  return {
    name: `palot-build-inputs-${phase}${worker ? "-worker" : ""}`,
    apply: "build",
    enforce: "pre",
    config(config) {
      if (!runDir) return;
      const limit = config.build?.assetsInlineLimit;
      return {
        build: {
          assetsInlineLimit(file, content) {
            captureFileInput(file);
            if (typeof limit === "function") return limit(file, content);
            if (typeof limit === "number") return content.length < limit;
            return undefined;
          },
        },
      };
    },
    configResolved(config) {
      resolvedConfig = config;
      root = config.root;
      publicDir = config.publicDir;
    },
    buildStart() {
      if (!runDir) return;
      request = readJson<BuildInputRequest>(path.join(runDir, "request.json"));
      if (!request.phases.includes(phase)) throw new Error(`Unexpected build phase: ${phase}`);
      save(false);
      if (!worker && publicDir && fs.existsSync(publicDir)) {
        for (const file of filesBelow(publicDir)) {
          captureFileInput(file);
          outputs.add(`${phase}/${path.relative(publicDir, file).split(path.sep).join("/")}`);
        }
      }
    },
    async load(moduleId) {
      if (runDir) {
        captureId(moduleId);
        const file = buildInputFileFromId(moduleId);
        if (file?.endsWith(".css") && !processedCss.has(file)) {
          processedCss.add(file);
          // CSS imports are consumed inside Vite/Tailwind, outside the JS module
          // graph. Vite's public preprocessor exposes their filesystem dependencies.
          const result = await preprocessCSS(fs.readFileSync(file, "utf8"), file, {
            ...resolvedConfig,
            css: { ...resolvedConfig.css, postcss: {} },
          });
          for (const dependency of result.deps ?? []) captureFileInput(dependency);
          // These Vite modes bypass both the inline callback and emitted asset
          // provenance. Reject them instead of accepting an incomplete inventory.
          if (
            /[?&]inline\b/.test(result.code) ||
            (resolvedConfig.build.lib && /url\(/i.test(result.code))
          ) {
            throw new Error(`CSS asset mode has no authoritative provenance hook: ${file}`);
          }
        }
      }
      return null;
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        if (!runDir) return;
        for (const moduleId of this.getModuleIds()) {
          const info = this.getModuleInfo(moduleId);
          if (!info) throw new Error(`Missing module information: ${moduleId}`);
          captureId(moduleId);
          for (const imported of [...info.importedIds, ...info.dynamicallyImportedIds]) {
            if (!this.getModuleInfo(imported)) externals.add(imported);
          }
        }
        for (const output of Object.values(bundle)) {
          outputs.add(`${phase}/${output.fileName}`);
          if (output.type === "chunk") {
            for (const moduleId of output.moduleIds) captureId(moduleId);
            // Bundlers may omit external modules from getModuleIds().
            for (const imported of [...output.imports, ...output.dynamicImports]) {
              if (!bundle[imported]) externals.add(imported);
            }
          } else {
            // Vite adds bundled workers to the parent bundle as generated JS assets.
            if (/\.[cm]?js$/.test(output.fileName) && output.originalFileNames.length === 0) {
              workerOutputsRequired.add(`${phase}/${output.fileName}`);
            }
            for (const original of output.originalFileNames) {
              captureFileInput(path.isAbsolute(original) ? original : path.resolve(root, original));
            }
          }
        }
        save(true);
      },
    },
  };
}

function assertDigest(digest: FileDigest): void {
  if (digestBuildInput(digest.path).sha256 !== digest.sha256) {
    throw new Error(`Build provenance hash mismatch: ${digest.path}`);
  }
}

function validateCaptures(manifest: BuildInputManifest, required: BuildPhase[]): void {
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported build input schema");
  for (const phase of required) {
    if (!manifest.phases.includes(phase)) throw new Error(`Missing build phase: ${phase}`);
    const primary = manifest.captures.filter(
      (capture) => capture.phase === phase && !capture.worker,
    );
    if (primary.length !== 1) throw new Error(`Missing or duplicate build phase capture: ${phase}`);
  }
  for (const capture of manifest.captures) {
    if (capture.runId !== manifest.runId || !capture.complete) {
      throw new Error(`Stale or incomplete build capture: ${capture.id}`);
    }
    for (const input of capture.inputs) assertDigest(input);
    for (const pkg of capture.packages) assertDigest(pkg.metadata);
    for (const output of capture.workerOutputsRequired) {
      if (!manifest.captures.some((worker) => worker.worker && worker.outputs.includes(output))) {
        throw new Error(`Missing worker build capture: ${output}`);
      }
    }
  }
  assertDigest(manifest.binding.lockfile);
}

/** Final output enumeration must agree with the bundlers, including worker and copied public assets. */
export function finishBuildInputCapture(runDir: string): BuildInputManifest {
  const request = readJson<BuildInputRequest>(path.join(runDir, "request.json"));
  const captures = fs
    .readdirSync(runDir)
    .filter((name) => /^(main|preload|renderer)-.*\.json$/.test(name))
    .map((name) => readJson<BuildInputCapture>(path.join(runDir, name)));
  const out = path.join(request.appRoot, "out");
  const outputs = request.phases
    .flatMap((phase) => filesBelow(path.join(out, phase)))
    .map((file) => ({
      path: path.relative(out, file).split(path.sep).join("/"),
      sha256: digestBuildInput(file).sha256,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const manifest: BuildInputManifest = { ...request, captures, outputs };
  validateCaptures(manifest, request.phases);
  const declared = new Set(captures.flatMap((capture) => capture.outputs));
  for (const output of outputs) {
    if (!declared.delete(output.path)) throw new Error(`Unaccounted build output: ${output.path}`);
  }
  if (declared.size) throw new Error(`Missing build outputs: ${[...declared].join(", ")}`);
  writeJson(path.join(runDir, "manifest.json"), manifest);
  return manifest;
}

/** Revalidates current bytes and identity; callers must explicitly list post-build native additions. */
export function readValidatedBuildInputs(options: {
  appRoot: string;
  runDir?: string;
  binding?: BuildInputBinding;
  additionalOutputs?: string[];
}): BuildInputManifest {
  const appRoot = path.resolve(options.appRoot);
  const latest = readJson<{ runId: string }>(path.join(storageRoot(appRoot), "latest.json"));
  const runDir = options.runDir ?? path.join(storageRoot(appRoot), latest.runId);
  const manifest = readJson<BuildInputManifest>(path.join(runDir, "manifest.json"));
  if (
    manifest.appRoot !== appRoot ||
    manifest.runId !== path.basename(runDir) ||
    manifest.runId !== latest.runId
  ) {
    throw new Error("Stale build input generation");
  }
  const expected = options.binding ?? currentBuildInputBinding(appRoot);
  if (JSON.stringify(manifest.binding) !== JSON.stringify(expected)) {
    throw new Error("Build identity or lockfile changed since input capture");
  }
  validateCaptures(manifest, ["main", "preload", "renderer"]);
  const out = path.join(appRoot, "out");
  const actual = new Set(
    filesBelow(out).map((file) => path.relative(out, file).split(path.sep).join("/")),
  );
  for (const output of manifest.outputs) {
    assertDigest({ ...output, path: path.join(out, output.path) });
    if (!actual.delete(output.path)) throw new Error(`Missing build output: ${output.path}`);
  }
  for (const extra of options.additionalOutputs ?? []) {
    if (!actual.delete(extra))
      throw new Error(`Missing or duplicate additional build output: ${extra}`);
  }
  if (actual.size) throw new Error(`Unaccounted build outputs: ${[...actual].join(", ")}`);
  return manifest;
}

export function provenancedPackageRoots(manifest: BuildInputManifest): BuildInputPackage[] {
  return [
    ...new Map(
      manifest.captures.flatMap((capture) => capture.packages).map((pkg) => [pkg.root, pkg]),
    ).values(),
  ].sort((a, b) => a.root.localeCompare(b.root));
}
