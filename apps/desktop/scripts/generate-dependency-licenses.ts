import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import reviewedEvidence from "../resources/licenses/DEPENDENCY_LICENSE_EVIDENCE.json" with { type: "json" };
import upstreamEvidence from "../resources/licenses/DEPENDENCY_LICENSE_UPSTREAM.json" with { type: "json" };
import { collectDeclaredLicenseText } from "./declared-license-inputs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_MODULES = path.resolve(APP_ROOT, "../../node_modules");
const OUTPUT = path.join(APP_ROOT, "resources/licenses/DEPENDENCY_LICENSES.md");
const UPSTREAM_TEXT = path.join(APP_ROOT, "resources/licenses/upstream");

interface LicenseEntry {
  location: string;
  name: string;
  version: string;
  license: string;
  reviewedLicense?: string;
  files: Array<{ name: string; content: string }>;
}

interface InventoryIssue {
  location: string;
  reason: string;
}

interface Inventory {
  entries: LicenseEntry[];
  issues: InventoryIssue[];
}

interface GenerateOptions {
  nodeModules?: string;
  output?: string;
  /** Write the report, then fail if the inventory contains errors. */
  check?: boolean;
  /** Explicit roots from a verified build/package inventory; do not traverse adjacent stores. */
  packageDirectories?: readonly string[];
}

/**
 * Normal packaging writes the inventory and reports diagnostics. Release checks
 * use --check to fail on missing text, invalid metadata, or changed source hashes.
 */
export async function generateDependencyLicenses(
  options: GenerateOptions = {},
): Promise<Inventory> {
  const inventory = await collectDependencyLicenses(
    options.nodeModules ?? NODE_MODULES,
    options.packageDirectories,
  );
  const output = options.output ?? OUTPUT;
  const { entries, issues } = inventory;
  const diagnostics = issues.length
    ? issues.map(({ location, reason }) => `- ${JSON.stringify(location)}: ${reason}`).join("\n")
    : "No inventory issues found.";
  const sections = entries.map((entry) => {
    const files = entry.files
      .map(({ name, content }) => `### ${name}\n\n${content.trim()}\n`)
      .join("\n");
    const reviewed = entry.reviewedLicense
      ? `Source license: ${entry.reviewedLicense} (verified against the recorded text hash).\n\n`
      : "";
    const location =
      options.packageDirectories === undefined
        ? `Installed location: ${JSON.stringify(entry.location)}\n\n`
        : "";
    return `## ${entry.name}@${entry.version}\n\n${location}Declared license: ${entry.license}\n\n${reviewed}${files || "No readable license or notice text found.\n"}`;
  });
  const scope =
    options.packageDirectories === undefined
      ? "Generated from packages reachable from the repository root node_modules, including nested dependencies and symlink targets. Linked packages and their node_modules containers are followed; unlinked package-manager stores and workspace installations are excluded. Build, test, and workspace packages may appear even when absent from a particular artifact. The release SBOM separately describes the pinned workspace lockfile."
      : "Generated from explicit package roots recorded by the build and extracted from the packaged application. Adjacent package-manager stores and unrelated build tools are not traversed. Embedded runtime components have separate notices.";
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    `# Dependency licenses\n\n${scope}\n\nLicense and notice text comes from package-root LICENSE, LICENCE, COPYING, and NOTICE files, supplemented by version-bound texts verified against recorded hashes. Declared metadata and source-text licenses are listed separately.\n\n## Inventory status: ${issues.length ? "INCOMPLETE" : "COMPLETE"}\n\n${entries.length} physical packages inventoried; ${issues.length} inventory issues.\n\n### Diagnostics\n\n${diagnostics}\n\n${sections.join("\n")}\n`,
  );
  if (issues.length) {
    const message = `Dependency license inventory has ${issues.length} inventory issues; see ${output}`;
    if (options.check) throw new Error(message);
    console.warn(message);
  }
  return inventory;
}

export async function collectDependencyLicenses(
  nodeModules: string,
  packageDirectories?: readonly string[],
): Promise<Inventory> {
  const root = path.resolve(nodeModules);
  const inventory: Inventory = { entries: [], issues: [] };
  const packages = new Set<string>();
  const containers = new Set<string>();
  const location = (file: string) => path.relative(root, file).split(path.sep).join("/") || ".";
  const issue = (file: string, reason: string) => {
    inventory.issues.push({ location: location(file), reason });
  };

  async function scanContainer(directory: string, optional = false, scope = false): Promise<void> {
    if (optional) {
      try {
        await lstat(directory);
      } catch (error) {
        if (errorCode(error) === "ENOENT") return;
        issue(directory, `Cannot inspect dependency directory (${errorCode(error)}).`);
        return;
      }
    }
    let resolved: string;
    try {
      resolved = await realpath(directory);
    } catch (error) {
      issue(directory, `Cannot resolve dependency directory (${errorCode(error)}).`);
      return;
    }
    if (containers.has(resolved)) return;
    containers.add(resolved);
    let children;
    try {
      children = await readdir(resolved, { withFileTypes: true });
    } catch (error) {
      issue(directory, `Cannot read dependency directory (${errorCode(error)}).`);
      return;
    }
    for (const child of children.toSorted((a, b) => a.name.localeCompare(b.name))) {
      // Never recursively sweep .bun/.pnpm stores, caches, or executable shims.
      if (child.name.startsWith(".") || (!child.isDirectory() && !child.isSymbolicLink())) continue;
      const target = path.join(resolved, child.name);
      if (!scope && child.name.startsWith("@")) await scanContainer(target, false, true);
      else await scanPackage(target);
    }
  }

  async function scanPackage(directory: string): Promise<void> {
    let resolved: string;
    try {
      resolved = await realpath(directory);
      if (!(await stat(resolved)).isDirectory()) {
        issue(directory, "Dependency target is not a directory.");
        return;
      }
    } catch (error) {
      issue(directory, `Cannot resolve package (${errorCode(error)}).`);
      return;
    }
    if (packages.has(resolved)) return;
    packages.add(resolved);
    const entry: LicenseEntry = {
      location: location(resolved),
      name: "(unknown package)",
      version: "(unknown version)",
      license: "Not declared",
      files: [],
    };
    inventory.entries.push(entry);
    try {
      const manifest = JSON.parse(await readFile(path.join(resolved, "package.json"), "utf8"));
      if (typeof manifest?.name === "string" && manifest.name.trim()) entry.name = manifest.name;
      else issue(resolved, "Package name is missing or invalid.");
      if (typeof manifest?.version === "string" && manifest.version.trim()) {
        entry.version = manifest.version;
      } else issue(resolved, "Package version is missing or invalid.");
      const declared =
        typeof manifest?.license === "string" ? manifest.license : manifest?.license?.type;
      if (typeof declared === "string" && declared.trim()) entry.license = declared;
    } catch (error) {
      issue(
        path.join(resolved, "package.json"),
        `Cannot read package metadata (${errorCode(error)}).`,
      );
    }
    const hasRootLicense = await collectText(resolved, entry);
    const hasEvidenceLicense =
      (!hasRootLicense || entry.license === "Not declared") &&
      ((await collectReviewedText(resolved, entry)) ||
        (await collectUpstreamText(resolved, entry)) ||
        (await collectDeclaredText(resolved, entry)));
    if (entry.license === "Not declared" && !hasEvidenceLicense) {
      issue(resolved, "Declared license is missing or invalid.");
    }
    if (!hasRootLicense && !hasEvidenceLicense) {
      issue(resolved, "No readable package-root license text (NOTICE alone is insufficient).");
    }
    if (packageDirectories !== undefined) return;
    await scanContainer(path.join(resolved, "node_modules"), true);

    // Isolated Bun/pnpm installs put dependency links beside the real package,
    // not inside it. Visit only that node_modules container, never the whole store.
    const parent = path.dirname(resolved);
    const container = path.basename(parent).startsWith("@") ? path.dirname(parent) : parent;
    if (path.basename(container) === "node_modules") await scanContainer(container);
  }

  async function collectText(directory: string, entry: LicenseEntry): Promise<boolean> {
    let files: string[];
    try {
      files = await readdir(directory);
    } catch (error) {
      issue(directory, `Cannot list license files (${errorCode(error)}).`);
      return false;
    }
    let hasLicense = false;
    for (const name of files.toSorted()) {
      if (!/^(licen[cs]e|copying|notice)(?:$|[._-])/i.test(name)) continue;
      const file = path.join(directory, name);
      try {
        if (!(await stat(file)).isFile()) {
          issue(file, "License or notice candidate is not a regular file.");
          continue;
        }
        const content = await readFile(file, "utf8");
        if (!content.trim() || content.includes("\0") || content.includes("\uFFFD")) {
          issue(file, "License or notice text is empty, binary, or invalid UTF-8.");
          continue;
        }
        entry.files.push({ name, content });
        if (/^(licen[cs]e|copying)/i.test(name)) hasLicense = true;
      } catch (error) {
        issue(file, `Cannot read license or notice text (${errorCode(error)}).`);
      }
    }
    return hasLicense;
  }

  async function collectDeclaredText(directory: string, entry: LicenseEntry): Promise<boolean> {
    try {
      const declared = await collectDeclaredLicenseText(
        directory,
        entry.name,
        entry.version,
        entry.license,
      );
      if (!declared) return false;
      entry.files.push({
        name: `${declared.sourceLabel} (${declared.name})`,
        content: declared.content,
      });
      return true;
    } catch (error) {
      issue(
        directory,
        `Invalid declared-license evidence: ${error instanceof Error ? error.message : errorCode(error)}`,
      );
      return false;
    }
  }

  async function collectUpstreamText(directory: string, entry: LicenseEntry): Promise<boolean> {
    for (const source of upstreamEvidence) {
      const evidence = source.packages.find(
        (item) => item.name === entry.name && item.version === entry.version,
      );
      if (!evidence) continue;
      try {
        const manifest = await readFile(path.join(directory, "package.json"));
        if (
          entry.license !== evidence.license ||
          createHash("sha256").update(manifest).digest("hex") !== evidence.manifestSha256
        ) {
          issue(directory, "Installed metadata does not match recorded upstream evidence.");
          return false;
        }
        // Validate version-bound archive/source metadata before loading retained
        // text. This offline operation does not re-download package archives.
        if (
          !/^[a-f0-9]{40}$/.test(source.commit) ||
          !evidence.archive.startsWith("https://registry.npmjs.org/") ||
          !/^sha512-[A-Za-z0-9+/]{86}==$/.test(evidence.integrity) ||
          !/^[a-f0-9]{64}$/.test(evidence.sourceManifestSha256) ||
          !source.files.some((file) =>
            /^(licen[cs]e|copying)(?:$|[._-])/i.test(path.basename(file.source)),
          )
        ) {
          issue(
            directory,
            "Reviewed upstream provenance is incomplete (NOTICE alone is insufficient).",
          );
          return false;
        }
        const files: LicenseEntry["files"] = [];
        for (const file of source.files) {
          const retained = path.join(UPSTREAM_TEXT, file.file);
          if (path.basename(file.file) !== file.file || !(await lstat(retained)).isFile()) {
            issue(
              directory,
              "Reviewed upstream text must be a retained regular file, not a symlink.",
            );
            return false;
          }
          const bytes = await readFile(retained);
          const content = bytes.toString("utf8");
          if (
            createHash("sha256").update(bytes).digest("hex") !== file.sha256 ||
            !content.trim() ||
            content.includes("\0") ||
            content.includes("\uFFFD")
          ) {
            issue(directory, "Recorded upstream text is invalid or its SHA-256 changed.");
            return false;
          }
          files.push({
            name: `Upstream ${source.repository}/${file.source} (${source.commit})`,
            content,
          });
        }
        // Do not mark the package resolved if any required text/notice failed.
        entry.files.push(...files);
        entry.reviewedLicense = evidence.license;
        return true;
      } catch (error) {
        issue(directory, `Cannot read reviewed upstream evidence (${errorCode(error)}).`);
        return false;
      }
    }
    return false;
  }

  async function collectReviewedText(directory: string, entry: LicenseEntry): Promise<boolean> {
    const evidence = reviewedEvidence.find(
      (item) => item.name === entry.name && item.version === entry.version,
    );
    if (!evidence) return false;
    if (entry.license !== "Not declared" && entry.license !== evidence.license) {
      issue(directory, "Declared license conflicts with reviewed local-text evidence.");
      return false;
    }
    try {
      let sourceRoot = directory;
      if (evidence.workspace) {
        sourceRoot = await realpath(path.dirname(root));
        const manifest = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
        // Only the explicitly reviewed first-party workspace, never arbitrary
        // ancestor licenses or a third-party package with the same name.
        if (
          directory !== path.join(sourceRoot, evidence.workspace) ||
          manifest.name !== "palot-2" ||
          manifest.license !== evidence.license ||
          entry.license !== evidence.license ||
          !Array.isArray(manifest.workspaces) ||
          !manifest.workspaces.includes(evidence.workspace)
        ) {
          issue(directory, "Reviewed workspace license ownership does not match.");
          return false;
        }
      }
      const source = path.join(sourceRoot, evidence.file);
      if (!(await lstat(source)).isFile()) {
        issue(source, "Reviewed license source is not a regular file (symlinks are not accepted).");
        return false;
      }
      const bytes = await readFile(source);
      if (createHash("sha256").update(bytes).digest("hex") !== evidence.sha256) {
        issue(source, "Recorded license source SHA-256 does not match.");
        return false;
      }
      const lines = bytes.toString("utf8").split("\n");
      const content = lines.slice(evidence.firstLine - 1, evidence.lastLine).join("\n");
      if (
        !Number.isInteger(evidence.firstLine) ||
        !Number.isInteger(evidence.lastLine) ||
        evidence.firstLine < 1 ||
        evidence.lastLine < evidence.firstLine ||
        evidence.lastLine > lines.length ||
        !content.trim() ||
        content.includes("\0") ||
        content.includes("\uFFFD")
      ) {
        issue(source, "Reviewed license text range is invalid, empty, or not UTF-8.");
        return false;
      }
      // Conventional license files are already included verbatim; do not duplicate.
      if (evidence.workspace || !entry.files.some((file) => file.name === evidence.file)) {
        const sourceName = evidence.workspace ? `repository/${evidence.file}` : evidence.file;
        entry.files.push({
          name: `${sourceName}:${evidence.firstLine}-${evidence.lastLine} (reviewed license text)`,
          content,
        });
      }
      entry.reviewedLicense = evidence.license;
      return true;
    } catch (error) {
      issue(directory, `Cannot read reviewed license evidence (${errorCode(error)}).`);
      return false;
    }
  }

  if (packageDirectories === undefined) await scanContainer(root);
  else {
    if (packageDirectories.length === 0)
      throw new Error("An artifact package inventory cannot be empty.");
    for (const directory of packageDirectories) await scanPackage(directory);
  }
  inventory.entries.sort((a, b) =>
    `${a.name}@${a.version}\0${a.location}`.localeCompare(`${b.name}@${b.version}\0${b.location}`),
  );
  inventory.issues.sort((a, b) =>
    `${a.location}\0${a.reason}`.localeCompare(`${b.location}\0${b.reason}`),
  );
  return inventory;
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "invalid data";
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) {
    throw new Error("Usage: bun apps/desktop/scripts/generate-dependency-licenses.ts [--check]");
  }
  await generateDependencyLicenses({ check: args.includes("--check") });
  console.log(`Generated ${OUTPUT}`);
}
