import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import declarations from "../resources/licenses/DEPENDENCY_LICENSE_DECLARATIONS.json" with { type: "json" };

type Declaration = (typeof declarations)[number];

interface DeclaredLicenseText {
  name: string;
  content: string;
  sourceLabel: string;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const isSha256 = (value: string) => /^[a-f0-9]{64}$/.test(value);
const isCommit = (value: string) => /^[a-f0-9]{40}$/.test(value);

/** Build an offline collector from explicit, version-bound declarations, never an SPDX fallback. */
export function createDeclaredLicenseCollector(
  records: readonly Declaration[],
  textDirectory: string,
) {
  return async function collectDeclaredLicenseText(
    directory: string,
    name: string,
    version: string,
    declaredLicense: string,
  ): Promise<DeclaredLicenseText | null> {
    const record = records.find((item) => item.name === name && item.version === version);
    if (!record) return null;
    const fail = (reason: string): never => {
      throw new Error(`Declared license evidence for ${name}@${version}: ${reason}`);
    };
    if (declaredLicense !== record.license)
      fail("declared license conflicts with recorded MIT declaration.");

    const manifest = await readFile(path.join(directory, "package.json"));
    if (sha256(manifest) !== record.manifestSha256) fail("installed manifest SHA-256 changed.");
    const installed = JSON.parse(manifest.toString("utf8"));
    if (
      installed.name !== name ||
      installed.version !== version ||
      installed.license !== declaredLicense
    ) {
      fail("installed package identity or license conflicts with recorded declaration.");
    }

    const { source, standard } = record;
    // Source and archive bytes were checked when recording this evidence. Packaging
    // verifies the installed manifest and retained standard text without network access.
    if (
      record.license !== "MIT" ||
      source.name !== name ||
      source.version !== version ||
      source.license !== record.license ||
      !source.repository ||
      !source.manifest ||
      !isCommit(source.commit) ||
      !isSha256(source.manifestSha256) ||
      !record.archive.startsWith("https://registry.npmjs.org/") ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(record.integrity) ||
      standard.licenseId !== record.license ||
      standard.repository !== "spdx/license-list-data" ||
      standard.source !== "text/MIT.txt" ||
      standard.metadataSource !== "json/details/MIT.json" ||
      !isCommit(standard.commit) ||
      !isSha256(standard.metadataSha256)
    ) {
      fail("source declaration or standard-text provenance is incomplete or conflicting.");
    }
    const textFile = path.join(textDirectory, standard.file);
    if (path.basename(standard.file) !== standard.file || !(await lstat(textFile)).isFile()) {
      fail("standard text must be a retained regular file, not a symlink.");
    }
    const bytes = await readFile(textFile);
    const text = bytes.toString("utf8");
    if (
      sha256(bytes) !== standard.sha256 ||
      !text.trim() ||
      text.includes("\0") ||
      text.includes("\uFFFD")
    ) {
      fail("standard text is invalid or its SHA-256 changed.");
    }
    const lines = text.replace(/\n$/, "").split("\n");
    const { headingLine, termsFirstLine, termsLastLine, templateCopyrightLine } = standard;
    if (
      ![headingLine, termsFirstLine, termsLastLine, templateCopyrightLine].every(
        Number.isInteger,
      ) ||
      headingLine !== 1 ||
      termsFirstLine <= templateCopyrightLine ||
      templateCopyrightLine <= headingLine ||
      termsFirstLine > termsLastLine ||
      termsLastLine !== lines.length ||
      lines[headingLine - 1] !== "MIT License" ||
      lines[templateCopyrightLine - 1] !== "Copyright (c) <year> <copyright holders>" ||
      lines
        .slice(headingLine, termsFirstLine - 1)
        .some(
          (line, index) => index + headingLine + 1 !== templateCopyrightLine && line.trim() !== "",
        )
    ) {
      fail(
        "standard-text ranges must retain all terms and omit only the template copyright placeholder.",
      );
    }
    return {
      name: `Standard SPDX ${standard.repository}/${standard.source} (${standard.commit})`,
      content: `${lines[headingLine - 1]}\n\n${lines.slice(termsFirstLine - 1, termsLastLine).join("\n")}\n`,
      sourceLabel: "Declared SPDX license: MIT; standard terms",
    };
  };
}

export const collectDeclaredLicenseText = createDeclaredLicenseCollector(
  declarations,
  path.resolve(import.meta.dirname, "../resources/licenses/upstream"),
);
