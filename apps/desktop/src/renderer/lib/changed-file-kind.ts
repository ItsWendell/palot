/**
 * Sorts a changed path into the kind of file it is, so diff views can stay quiet about files
 * people rarely review. Lockfiles, generated files and migrations start collapsed; tests stay
 * open but carry a label. Path rules only, plus `linguist-generated` lines from a repository's
 * `.gitattributes` when the caller has it.
 *
 * Pure: no React, no OpenCode.
 */

export type ChangedFileKind = "lockfile" | "generated" | "migration" | "test" | "regular";

/** Kinds that start collapsed and count apart from the change's main totals. */
export type QuietChangedFileKind = Extract<ChangedFileKind, "lockfile" | "generated" | "migration">;

const QUIET_KINDS: readonly QuietChangedFileKind[] = ["lockfile", "generated", "migration"];

const LABELS: Record<Exclude<ChangedFileKind, "regular">, string> = {
  lockfile: "Lockfile",
  generated: "Generated",
  migration: "Migration",
  test: "Test",
};

const LOCKFILES = new Set([
  ".terraform.lock.hcl",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "Cartfile.resolved",
  "composer.lock",
  "deno.lock",
  "flake.lock",
  "Gemfile.lock",
  "go.sum",
  "go.work.sum",
  "gradle.lockfile",
  "mix.lock",
  "npm-shrinkwrap.json",
  "Package.resolved",
  "package-lock.json",
  "packages.lock.json",
  "pdm.lock",
  "Pipfile.lock",
  "pnpm-lock.yaml",
  "Podfile.lock",
  "poetry.lock",
  "pubspec.lock",
  "uv.lock",
  "yarn.lock",
]);

const GENERATED_DIRECTORIES = new Set([
  "__generated__",
  "__snapshots__",
  "build",
  "dist",
  "generated",
]);

const GENERATED_NAME =
  /(?:\.(?:generated|gen)\.[^/]+$|[_-]generated\.[^/]+$|\.snap$|\.min\.[cm]?(?:js|css)$|\.(?:[cm]?js|css)\.map$|\.pb(?:\.gw)?\.(?:go|h|cc|swift|dart|rs)$|_pb2(?:_grpc)?\.pyi?$|_(?:grpc_)?pb\.(?:js|ts|d\.ts)$)/;

const SNAPSHOT = /(?:^|\/)__snapshots__\/|\.snap$/;

const TEST_DIRECTORIES = new Set([
  "__mocks__",
  "__tests__",
  "e2e",
  "spec",
  "test",
  "testdata",
  "tests",
]);

const TEST_NAME =
  /(?:\.(?:test|spec)\.(?:[cm]?[jt]sx?|py|rb|php|vue|svelte|dart)$|_test\.(?:go|py|rs|exs?)$|^test_[^/]+\.py$|_spec\.rb$|[a-z0-9]Tests?\.(?:java|kt|cs|swift|scala)$)/;

const MIGRATION_DIRECTORIES = new Set(["migration", "migrations"]);

/** One `linguist-generated` line from `.gitattributes`: later lines win. */
export interface GeneratedAttributeRule {
  pattern: RegExp;
  generated: boolean;
}

export function classifyChangedFile(
  path: string,
  rules: readonly GeneratedAttributeRule[] = [],
): ChangedFileKind {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  const name = segments.at(-1) ?? normalized;
  const directories = segments.slice(0, -1);
  if (LOCKFILES.has(name)) return "lockfile";
  const attribute = generatedAttribute(normalized, rules);
  if (attribute === true) return "generated";
  if (attribute === undefined && isGeneratedPath(name, directories)) return "generated";
  if (isMigrationPath(name, directories)) return "migration";
  if (isTestPath(name, directories)) return "test";
  return "regular";
}

export function isQuietKind(kind: ChangedFileKind): kind is QuietChangedFileKind {
  return kind === "lockfile" || kind === "generated" || kind === "migration";
}

/** The quiet label diff headers and file lists show, or null for a regular file. */
export function changedFileKindLabel(kind: ChangedFileKind): string | null {
  return kind === "regular" ? null : LABELS[kind];
}

/** Snapshots are generated, but the review guide names them with lockfiles. */
export function isSnapshotPath(path: string): boolean {
  return SNAPSHOT.test(path);
}

function isGeneratedPath(name: string, directories: readonly string[]): boolean {
  return GENERATED_NAME.test(name) || directories.some((dir) => GENERATED_DIRECTORIES.has(dir));
}

function isMigrationPath(name: string, directories: readonly string[]): boolean {
  return directories.some((dir, index) => {
    if (MIGRATION_DIRECTORIES.has(dir)) return true;
    // Rails keeps them in db/migrate, Alembic in alembic/versions.
    if (dir === "migrate" && directories[index - 1] === "db") return true;
    if (dir === "versions" && directories[index - 1] === "alembic") return true;
    // drizzle-kit writes SQL and JSON snapshots under its `drizzle` output folder.
    return dir === "drizzle" && /\.(?:sql|json)$/.test(name);
  });
}

function isTestPath(name: string, directories: readonly string[]): boolean {
  return TEST_NAME.test(name) || directories.some((dir) => TEST_DIRECTORIES.has(dir));
}

function generatedAttribute(
  path: string,
  rules: readonly GeneratedAttributeRule[],
): boolean | undefined {
  let result: boolean | undefined;
  for (const rule of rules) if (rule.pattern.test(path)) result = rule.generated;
  return result;
}

/**
 * Reads `linguist-generated` lines from a root `.gitattributes`. `linguist-generated` and
 * `=true` mark a path generated; `-linguist-generated` and `=false` take that back, also for
 * paths the built-in rules would call generated.
 */
export function parseGeneratedAttributes(text: string): GeneratedAttributeRule[] {
  const rules: GeneratedAttributeRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [pattern, ...attributes] = line.split(/\s+/);
    if (!pattern || pattern.endsWith("/")) continue;
    let generated: boolean | undefined;
    for (const attribute of attributes) {
      if (attribute === "linguist-generated" || attribute === "linguist-generated=true")
        generated = true;
      else if (
        attribute === "-linguist-generated" ||
        attribute === "!linguist-generated" ||
        attribute === "linguist-generated=false"
      )
        generated = false;
    }
    if (generated !== undefined) rules.push({ pattern: gitPatternToRegExp(pattern), generated });
  }
  return rules;
}

/** Git's wildmatch rules for a pattern in the repository's root `.gitattributes`. */
function gitPatternToRegExp(pattern: string): RegExp {
  const anchored = pattern.replace(/^\//, "");
  // A slash anywhere but the end ties the pattern to the root; otherwise it matches a name.
  const hasSlash = pattern.includes("/");
  let source = "";
  for (let index = 0; index < anchored.length; index += 1) {
    const char = anchored[index]!;
    if (char === "*") {
      if (anchored[index + 1] === "*") {
        const atStart = index === 0;
        const followedBySlash = anchored[index + 2] === "/";
        if (atStart && followedBySlash) {
          source += "(?:.*/)?";
          index += 2;
        } else if (anchored[index - 1] === "/" && followedBySlash) {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "[") {
      const close = anchored.indexOf("]", index + 1);
      if (close < 0) {
        source += "\\[";
      } else {
        const body = anchored
          .slice(index + 1, close)
          .replace(/^!/, "^")
          .replace(/\\/g, "\\\\");
        source += `[${body}]`;
        index = close;
      }
    } else {
      source += char.replace(/[.+^${}()|\\]/g, "\\$&");
    }
  }
  return new RegExp(hasSlash ? `^${source}$` : `(?:^|/)${source}$`);
}

export interface ChangeTotals {
  files: number;
  additions: number;
  deletions: number;
}

export interface ChangeSummary {
  /** Regular and test files: what the change is about. */
  main: ChangeTotals;
  /** Lockfiles, generated files and migrations. */
  quiet: ChangeTotals & { kinds: Record<QuietChangedFileKind, number> };
}

export function summarizeChanges(
  files: readonly { kind: ChangedFileKind; additions: number; deletions: number }[],
): ChangeSummary {
  const main: ChangeTotals = { files: 0, additions: 0, deletions: 0 };
  const quiet: ChangeSummary["quiet"] = {
    files: 0,
    additions: 0,
    deletions: 0,
    kinds: { lockfile: 0, generated: 0, migration: 0 },
  };
  for (const file of files) {
    const bucket = isQuietKind(file.kind) ? quiet : main;
    bucket.files += 1;
    bucket.additions += file.additions;
    bucket.deletions += file.deletions;
    if (isQuietKind(file.kind)) quiet.kinds[file.kind] += 1;
  }
  return { main, quiet };
}

/** "1 lockfile, 2 generated" for the quiet part of a change. */
export function describeQuietFiles(kinds: Record<QuietChangedFileKind, number>): string {
  const words: Record<QuietChangedFileKind, [string, string]> = {
    lockfile: ["lockfile", "lockfiles"],
    generated: ["generated", "generated"],
    migration: ["migration", "migrations"],
  };
  return QUIET_KINDS.filter((kind) => kinds[kind] > 0)
    .map((kind) => `${kinds[kind]} ${words[kind][kinds[kind] === 1 ? 0 : 1]}`)
    .join(", ");
}

/** Regular and test files first, quiet ones after, each group in its original order. */
export function orderQuietLast<T>(items: readonly T[], kindOf: (item: T) => ChangedFileKind): T[] {
  const main: T[] = [];
  const quiet: T[] = [];
  for (const item of items) (isQuietKind(kindOf(item)) ? quiet : main).push(item);
  return [...main, ...quiet];
}
