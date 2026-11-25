/**
 * Fail when the Effect family drifts from the version @opencode/protocol is built on.
 * Two Effect copies give the client and Palot different runtime identities for the
 * same schemas and services, which breaks in ways typecheck does not catch.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Packages, per workspace manifest, that must equal the protocol's Effect version. */
const PINNED = {
  "apps/desktop/package.json": ["effect", "@effect/platform-node", "@effect/platform-node-shared"],
  "packages/opencode-voice-coordinator/package.json": ["effect"],
} as const;

export interface EffectPinInput {
  /** The `effect` dependency declared by the installed `@opencode/protocol`. */
  protocolEffect: string | undefined;
  /** Declared versions keyed by `<manifest>: <package>`. */
  declared: Record<string, string | undefined>;
  /** Every `effect` version the lockfile resolves. */
  lockedEffect: readonly string[];
}

export function effectPinProblems(input: EffectPinInput): string[] {
  const expected = input.protocolEffect;
  if (!expected || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(expected)) {
    return [
      `@opencode/protocol must depend on an exact effect version (found ${expected ?? "none"})`,
    ];
  }
  const problems: string[] = [];
  for (const [entry, version] of Object.entries(input.declared)) {
    if (version !== expected) {
      problems.push(`${entry} is ${version ?? "missing"}, expected ${expected}`);
    }
  }
  const locked = [...new Set(input.lockedEffect)].toSorted();
  if (locked.length !== 1 || locked[0] !== expected) {
    problems.push(
      `bun.lock resolves effect ${locked.join(", ") || "nowhere"}, expected only ${expected}`,
    );
  }
  return problems;
}

/** Versions of `name` among the lockfile's resolved packages, including nested copies. */
export function lockedVersions(lockfile: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const entry = new RegExp(`^ {4}"[^"]+": \\["${escaped}@([^"]+)"`, "gm");
  return [...lockfile.matchAll(entry)].map((match) => match[1]!);
}

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readManifest(file: string): Promise<Manifest> {
  return JSON.parse(await readFile(file, "utf8")) as Manifest;
}

async function protocolManifest(root: string): Promise<Manifest> {
  for (const directory of [path.join(root, "apps/desktop"), root]) {
    try {
      return await readManifest(
        path.join(directory, "node_modules/@opencode/protocol/package.json"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("@opencode/protocol is not installed; run vp install first.");
}

if (import.meta.main) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const declared: Record<string, string | undefined> = {};
  for (const [manifest, names] of Object.entries(PINNED)) {
    const json = await readManifest(path.join(root, manifest));
    for (const name of names) {
      declared[`${manifest}: ${name}`] = json.dependencies?.[name] ?? json.devDependencies?.[name];
    }
  }
  const problems = effectPinProblems({
    protocolEffect: (await protocolManifest(root)).dependencies?.effect,
    declared,
    lockedEffect: lockedVersions(await readFile(path.join(root, "bun.lock"), "utf8"), "effect"),
  });
  if (problems.length) {
    console.error(`Effect pin drifted:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`Effect family pinned to ${declared["apps/desktop/package.json: effect"]}.`);
  }
}
