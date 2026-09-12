// @vitest-environment node

import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectDependencyLicenses,
  generateDependencyLicenses,
} from "./generate-dependency-licenses";

// Exercise the production evidence mechanism without depending on today's
// transitive install. Real reviewed records are checked during the strict audit.
vi.mock("../resources/licenses/DEPENDENCY_LICENSE_EVIDENCE.json", async () => {
  const { createHash } = await import("node:crypto");
  const text = "Package documentation\nCopyright Example contributors\nFull reviewed grant\n";
  const record = {
    name: "reviewed-example",
    version: "1.0.0",
    license: "MIT",
    file: "README.md",
    sha256: createHash("sha256").update(text).digest("hex"),
    firstLine: 2,
    lastLine: 3,
    source: "Exact-version fixture tarball",
  };
  return {
    default: [
      record,
      { ...record, name: "reviewed-root", file: "LICENSE" },
      { ...record, name: "reviewed-invalid", firstLine: 0 },
      { ...record, name: "@palot/desktop", workspace: "apps/desktop", file: "LICENSE" },
    ],
  };
});

const reviewedText = "Package documentation\nCopyright Example contributors\nFull reviewed grant\n";

const upstreamFixture = vi.hoisted(() => ({ failure: "" }));
vi.mock("../resources/licenses/DEPENDENCY_LICENSE_UPSTREAM.json", async () => {
  const { createHash } = await import("node:crypto");
  const manifest = JSON.stringify({ name: "upstream-example", version: "1.0.0", license: "MIT" });
  return {
    default: [
      {
        repository: "fixture/upstream-example",
        get commit() {
          return upstreamFixture.failure === "provenance" ? "main" : "a".repeat(40);
        },
        release: "fixture tag v1.0.0",
        // Stable, checked-in text fixtures; never read today's transitive install.
        get files() {
          const license = {
            source: "LICENSE",
            file: "lukeed.LICENSE.txt",
            sha256: "ba573393f24555ac0528612ad39665fab5bdcc80330a61096024bbf5f736526d",
          };
          const notice = {
            source: "NOTICE",
            file: "jake.NOTICE.txt",
            sha256: "c7e69411ad0251db3dd4f47cce1338137128b9f668e47a6c88f7059b6a63a29f",
          };
          if (upstreamFixture.failure === "notice only") return [notice];
          if (upstreamFixture.failure === "text hash") notice.sha256 = "0".repeat(64);
          if (upstreamFixture.failure === "missing notice")
            notice.file = "absent-fixture.NOTICE.txt";
          if (upstreamFixture.failure === "escaping path")
            license.file = "../upstream/lukeed.LICENSE.txt";
          return [license, notice];
        },
        packages: [
          {
            name: "upstream-example",
            version: "1.0.0",
            license: "MIT",
            sourceManifest: "package.json",
            sourceManifestSha256: "b".repeat(64),
            archive: "https://registry.npmjs.org/upstream-example/-/upstream-example-1.0.0.tgz",
            integrity: `sha512-${"A".repeat(86)}==`,
            manifestSha256: createHash("sha256").update(manifest).digest("hex"),
          },
        ],
      },
    ],
  };
});

let fixture: string;
let nodeModules: string;

beforeEach(async () => {
  upstreamFixture.failure = "";
  const temporaryRoot = path.join(tmpdir(), "opencode");
  await mkdir(temporaryRoot, { recursive: true });
  fixture = await realpath(await mkdtemp(path.join(temporaryRoot, "dependency-licenses-")));
  nodeModules = path.join(fixture, "node_modules");
  await mkdir(nodeModules);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(fixture, { recursive: true, force: true });
});

async function packageAt(
  directory: string,
  name: string,
  license: string | { type: string } | null = "MIT",
  text: string | null = "Example license text",
) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({ name, version: "1.0.0", license }),
  );
  if (text !== null) await writeFile(path.join(directory, "LICENSE"), text);
  return directory;
}

describe("dependency license inventory", () => {
  it("validates explicit artifact roots without sweeping unrelated store neighbors", async () => {
    const used = await packageAt(path.join(nodeModules, ".bun/pkg/node_modules/used"), "used");
    await packageAt(
      path.join(nodeModules, ".bun/pkg/node_modules/build-only"),
      "build-only",
      null,
      null,
    );
    const nested = await packageAt(path.join(used, "node_modules/nested"), "nested", null, null);
    const inventory = await collectDependencyLicenses(nodeModules, [used]);
    expect(inventory.entries.map((entry) => entry.name)).toEqual(["used"]);
    expect(inventory.issues).toEqual([]);
    // Inclusion is owned by the caller's verified inventory, never a license-error filter.
    const included = await collectDependencyLicenses(nodeModules, [used, nested]);
    expect(included.issues.length).toBeGreaterThan(0);
    await expect(collectDependencyLicenses(nodeModules, [])).rejects.toThrow("cannot be empty");
  });

  it("fails a scoped report for missing roots or notices just like the complete inventory", async () => {
    const used = await packageAt(path.join(nodeModules, "used"), "used", "MIT", null);
    const output = path.join(fixture, "artifact-licenses.md");
    await expect(
      generateDependencyLicenses({ nodeModules, output, check: true, packageDirectories: [used] }),
    ).rejects.toThrow("inventory issues");
    await expect(
      generateDependencyLicenses({
        nodeModules,
        output,
        check: true,
        packageDirectories: [path.join(fixture, "missing")],
      }),
    ).rejects.toThrow("inventory issues");
  });

  it("retains complete upstream license and notice text only for the reviewed installed manifest", async () => {
    const directory = await packageAt(
      path.join(nodeModules, "upstream-example"),
      "upstream-example",
      "MIT",
      null,
    );
    const output = path.join(fixture, "report.md");
    const inventory = await generateDependencyLicenses({ nodeModules, output, check: true });
    expect(inventory.issues).toEqual([]);
    expect(inventory.entries[0]?.reviewedLicense).toBe("MIT");
    expect(inventory.entries[0]?.files).toHaveLength(2);
    const report = await readFile(output, "utf8");
    expect(report).toContain("Copyright (c) Luke Edwards");
    expect(report).toContain("Copyright 2112 Matthew Eernisse");
    expect(report).toContain(`Upstream fixture/upstream-example/LICENSE (${"a".repeat(40)})`);
    // Even unchanged name/version/license cannot excuse different archive metadata.
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        name: "upstream-example",
        version: "1.0.0",
        license: "MIT",
        modified: true,
      }),
    );
    const changed = await collectDependencyLicenses(nodeModules);
    expect(changed.entries[0]?.reviewedLicense).toBeUndefined();
    expect(changed.issues).toContainEqual({
      location: "upstream-example",
      reason: "Installed metadata does not match recorded upstream evidence.",
    });
  });

  it.each(["provenance", "notice only", "text hash", "missing notice", "escaping path"])(
    "keeps the strict gate failing for upstream evidence with %s failure",
    async (failure) => {
      upstreamFixture.failure = failure;
      await packageAt(path.join(nodeModules, "upstream-example"), "upstream-example", "MIT", null);
      const inventory = await collectDependencyLicenses(nodeModules);
      expect(inventory.entries[0]?.reviewedLicense).toBeUndefined();
      expect(inventory.entries[0]?.files).toEqual([]);
      expect(inventory.issues).toContainEqual({
        location: "upstream-example",
        reason: "No readable package-root license text (NOTICE alone is insufficient).",
      });
      await expect(
        generateDependencyLicenses({
          nodeModules,
          output: path.join(fixture, "report.md"),
          check: true,
        }),
      ).rejects.toThrow("inventory issues");
    },
  );

  it("keeps all real retained upstream texts byte-identical to their reviewed hashes", async () => {
    const { createHash } = await import("node:crypto");
    const { default: sources } = await vi.importActual<{
      default: typeof import("../resources/licenses/DEPENDENCY_LICENSE_UPSTREAM.json");
    }>("../resources/licenses/DEPENDENCY_LICENSE_UPSTREAM.json");
    const identities = new Set<string>();
    for (const source of sources) {
      expect(source.commit).toMatch(/^[a-f0-9]{40}$/);
      for (const evidence of source.packages) {
        const identity = `${evidence.name}@${evidence.version}`;
        expect(identities.has(identity), identity).toBe(false);
        identities.add(identity);
      }
      for (const file of source.files) {
        expect(path.basename(file.file)).toBe(file.file);
        const bytes = await readFile(
          new URL(`../resources/licenses/upstream/${file.file}`, import.meta.url),
        );
        expect(createHash("sha256").update(bytes).digest("hex"), file.file).toBe(file.sha256);
      }
    }
  });

  it("reviews omitted metadata against the existing root text without duplicating it", async () => {
    const directory = await packageAt(
      path.join(nodeModules, "reviewed-root"),
      "reviewed-root",
      null,
      reviewedText,
    );
    const inventory = await collectDependencyLicenses(nodeModules);
    expect(inventory.issues).toEqual([]);
    expect(inventory.entries[0]).toMatchObject({
      license: "Not declared",
      reviewedLicense: "MIT",
      files: [{ name: "LICENSE", content: reviewedText }],
    });
    await writeFile(path.join(directory, "LICENSE"), "MIT");
    const changed = await collectDependencyLicenses(nodeModules);
    expect(changed.entries[0]?.reviewedLicense).toBeUndefined();
    expect(changed.issues).toContainEqual({
      location: "reviewed-root",
      reason: "Declared license is missing or invalid.",
    });
  });

  it("does not suppress broken conventional candidates when reviewed text is valid", async () => {
    const directory = await packageAt(
      path.join(nodeModules, "reviewed-example"),
      "reviewed-example",
      "MIT",
      "",
    );
    await writeFile(path.join(directory, "README.md"), reviewedText);
    const inventory = await collectDependencyLicenses(nodeModules);
    expect(inventory.entries[0]?.reviewedLicense).toBe("MIT");
    expect(inventory.issues).toContainEqual({
      location: "reviewed-example/LICENSE",
      reason: "License or notice text is empty, binary, or invalid UTF-8.",
    });
    await expect(
      generateDependencyLicenses({
        nodeModules,
        output: path.join(fixture, "report.md"),
        check: true,
      }),
    ).rejects.toThrow("inventory issues");
  });

  it("includes only hash-reviewed README license lines and preserves missing metadata", async () => {
    const directory = await packageAt(
      path.join(nodeModules, "reviewed-example"),
      "reviewed-example",
      null,
      null,
    );
    await writeFile(path.join(directory, "README.md"), reviewedText);
    const output = path.join(fixture, "report.md");
    const inventory = await generateDependencyLicenses({ nodeModules, output, check: true });
    expect(inventory.issues).toEqual([]);
    expect(inventory.entries[0]).toMatchObject({
      license: "Not declared",
      reviewedLicense: "MIT",
      files: [
        {
          name: "README.md:2-3 (reviewed license text)",
          content: "Copyright Example contributors\nFull reviewed grant",
        },
      ],
    });
    const report = await readFile(output, "utf8");
    expect(report).toContain("Declared license: Not declared");
    expect(report).toContain("Source license: MIT");
    expect(report).not.toContain("Package documentation");
  });

  it.each([
    "changed bytes",
    "changed version",
    "conflicting declaration",
    "unreviewed package",
    "invalid reviewed range",
    "missing text",
    "symlink text",
  ])("does not resolve a reviewed-text finding with %s", async (variation) => {
    const directory = await packageAt(
      path.join(nodeModules, "reviewed-example"),
      "reviewed-example",
      "MIT",
      null,
    );
    const source = path.join(directory, "README.md");
    await writeFile(source, reviewedText);
    if (variation === "changed bytes") await writeFile(source, "MIT");
    if (variation === "changed version")
      await writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({ name: "reviewed-example", version: "1.0.1", license: "MIT" }),
      );
    if (variation === "conflicting declaration")
      await writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({ name: "reviewed-example", version: "1.0.0", license: "ISC" }),
      );
    if (variation === "unreviewed package")
      await writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({ name: "another-package", version: "1.0.0", license: "MIT" }),
      );
    if (variation === "invalid reviewed range")
      await writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({ name: "reviewed-invalid", version: "1.0.0", license: "MIT" }),
      );
    if (variation === "missing text" || variation === "symlink text") await rm(source);
    if (variation === "symlink text") {
      await writeFile(path.join(fixture, "external-text"), reviewedText);
      await symlink(path.join(fixture, "external-text"), source);
    }
    const inventory = await collectDependencyLicenses(nodeModules);
    expect(inventory.entries[0]?.reviewedLicense).toBeUndefined();
    expect(inventory.issues).toContainEqual({
      location: "reviewed-example",
      reason: "No readable package-root license text (NOTICE alone is insufficient).",
    });
    await expect(
      generateDependencyLicenses({
        nodeModules,
        output: path.join(fixture, "report.md"),
        check: true,
      }),
    ).rejects.toThrow("inventory issues");
  });

  it("inherits only the explicitly reviewed physical workspace's matching repository license", async () => {
    await writeFile(
      path.join(fixture, "package.json"),
      JSON.stringify({ name: "palot-2", license: "MIT", workspaces: ["apps/desktop"] }),
    );
    await writeFile(path.join(fixture, "LICENSE"), reviewedText);
    const workspace = await packageAt(
      path.join(fixture, "apps/desktop"),
      "@palot/desktop",
      "MIT",
      null,
    );
    await symlink(workspace, path.join(nodeModules, "desktop"), "dir");
    expect((await collectDependencyLicenses(nodeModules)).issues).toEqual([]);
    await packageAt(path.join(nodeModules, "pretender"), "@palot/desktop", "MIT", null);
    let inventory = await collectDependencyLicenses(nodeModules);
    expect(
      inventory.entries.find((entry) => entry.location === "pretender")?.reviewedLicense,
    ).toBeUndefined();
    expect(inventory.issues).toContainEqual({
      location: "pretender",
      reason: "Reviewed workspace license ownership does not match.",
    });
    await rm(path.join(nodeModules, "pretender"), { recursive: true });
    await writeFile(
      path.join(fixture, "package.json"),
      JSON.stringify({ name: "palot-2", license: "MIT", workspaces: ["apps/*"] }),
    );
    inventory = await collectDependencyLicenses(nodeModules);
    expect(inventory.issues).toContainEqual({
      location: "../apps/desktop",
      reason: "Reviewed workspace license ownership does not match.",
    });
    await writeFile(
      path.join(fixture, "package.json"),
      JSON.stringify({ name: "unrelated", license: "MIT", workspaces: ["apps/desktop"] }),
    );
    expect(
      (await collectDependencyLicenses(nodeModules)).entries[0]?.reviewedLicense,
    ).toBeUndefined();
  });

  it.each(["root declaration", "workspace declaration", "root text", "external workspace"])(
    "rejects workspace inheritance with changed %s",
    async (variation) => {
      await writeFile(
        path.join(fixture, "package.json"),
        JSON.stringify({
          name: "palot-2",
          license: variation === "root declaration" ? "ISC" : "MIT",
          workspaces: ["apps/desktop"],
        }),
      );
      await writeFile(
        path.join(fixture, "LICENSE"),
        variation === "root text" ? "MIT" : reviewedText,
      );
      const workspace = await packageAt(
        path.join(fixture, variation === "external workspace" ? "external" : "apps/desktop"),
        "@palot/desktop",
        variation === "workspace declaration" ? "ISC" : "MIT",
        null,
      );
      if (variation === "external workspace") {
        await mkdir(path.join(fixture, "apps"));
        await symlink(workspace, path.join(fixture, "apps/desktop"), "dir");
      }
      await symlink(path.join(fixture, "apps/desktop"), path.join(nodeModules, "desktop"), "dir");
      const inventory = await collectDependencyLicenses(nodeModules);
      expect(inventory.entries[0]?.reviewedLicense).toBeUndefined();
      await expect(
        generateDependencyLicenses({
          nodeModules,
          output: path.join(fixture, "report.md"),
          check: true,
        }),
      ).rejects.toThrow("inventory issues");
    },
  );

  it("follows scoped/workspace links, nested packages, and cycles once per real path", async () => {
    const workspace = await packageAt(
      path.join(fixture, "packages", "workspace"),
      "@local/workspace",
    );
    const nested = await packageAt(path.join(workspace, "node_modules", "child"), "child");
    await mkdir(path.join(nodeModules, "@local"));
    await symlink(workspace, path.join(nodeModules, "@local", "workspace"), "dir");
    await symlink(workspace, path.join(nodeModules, "alias"), "dir");
    await mkdir(path.join(nested, "node_modules"));
    await symlink(workspace, path.join(nested, "node_modules", "cycle"), "dir");
    await packageAt(path.join(nodeModules, "hoisted"), "hoisted");

    const inventory = await collectDependencyLicenses(nodeModules);
    expect(inventory.entries.map((entry) => entry.name)).toEqual([
      "@local/workspace",
      "child",
      "hoisted",
    ]);
    expect(inventory.issues).toEqual([]);
    expect(inventory.entries[0]?.location).toBe("../packages/workspace");
  });

  it("follows isolated-store sibling dependencies without sweeping unrelated store packages", async () => {
    const store = path.join(nodeModules, ".bun");
    const firstContainer = path.join(store, "first@1", "node_modules");
    const first = await packageAt(path.join(firstContainer, "@scope", "first"), "@scope/first");
    const second = await packageAt(
      path.join(store, "second@1", "node_modules", "second"),
      "second",
    );
    await symlink(first, path.join(nodeModules, "first"), "dir");
    await symlink(second, path.join(firstContainer, "second"), "dir");
    await packageAt(
      path.join(store, "unrelated@1", "node_modules", "unrelated"),
      "unrelated",
      null,
      null,
    );
    await packageAt(path.join(nodeModules, ".cache", "irrelevant"), "cache", null, null);
    await packageAt(
      path.join(first, "examples", "node_modules", "irrelevant"),
      "example",
      null,
      null,
    );

    const inventory = await collectDependencyLicenses(nodeModules);
    expect(inventory.entries.map((entry) => entry.name)).toEqual(["@scope/first", "second"]);
    expect(inventory.issues).toEqual([]);
  });

  it("preserves declarations, notices, and separate physical copies even when text is missing", async () => {
    await packageAt(path.join(nodeModules, "missing"), "missing", { type: "Apache-2.0" }, null);
    const notice = await packageAt(path.join(nodeModules, "notice"), "notice", "MIT", null);
    await writeFile(path.join(notice, "NOTICE.txt"), "Attribution only");
    const licensed = await packageAt(path.join(nodeModules, "licensed"), "licensed", "MIT", null);
    await writeFile(path.join(licensed, "LICENSE-MIT"), "License text");
    await packageAt(
      path.join(licensed, "node_modules", "missing"),
      "missing",
      "BSD-2-Clause",
      null,
    );

    const inventory = await collectDependencyLicenses(nodeModules);
    expect(
      inventory.entries
        .filter((entry) => entry.name === "missing")
        .map((entry) => entry.license)
        .sort(),
    ).toEqual(["Apache-2.0", "BSD-2-Clause"]);
    expect(inventory.entries.find((entry) => entry.name === "notice")?.files).toEqual([
      { name: "NOTICE.txt", content: "Attribution only" },
    ]);
    expect(inventory.issues).toHaveLength(3);
    expect(
      inventory.issues.every((issue) =>
        issue.reason.includes("No readable package-root license text"),
      ),
    ).toBe(true);
  });

  it("reports bad metadata, unreadable candidates, broken links, and empty/binary text without aborting", async () => {
    const malformed = await packageAt(path.join(nodeModules, "malformed"), "malformed");
    await writeFile(path.join(malformed, "package.json"), "not json");
    const undeclared = await packageAt(
      path.join(nodeModules, "undeclared"),
      "undeclared",
      null,
      "",
    );
    await writeFile(path.join(undeclared, "COPYING"), "binary\0text");
    await mkdir(path.join(undeclared, "NOTICE"));
    await symlink(path.join(fixture, "absent"), path.join(undeclared, "LICENSE.txt"));
    await symlink(path.join(fixture, "absent"), path.join(nodeModules, "broken"), "dir");
    await symlink(path.join(fixture, "absent"), path.join(malformed, "node_modules"), "dir");
    const noManifest = path.join(nodeModules, "no-manifest");
    await mkdir(noManifest);
    const noIdentity = await packageAt(path.join(nodeModules, "no-identity"), "no-identity");
    await writeFile(path.join(noIdentity, "package.json"), JSON.stringify({ license: "MIT" }));

    const inventory = await collectDependencyLicenses(nodeModules);
    expect(inventory.entries).toHaveLength(4);
    expect(inventory.issues).toEqual(
      expect.arrayContaining([
        {
          location: "malformed/package.json",
          reason: "Cannot read package metadata (invalid data).",
        },
        { location: "no-manifest/package.json", reason: "Cannot read package metadata (ENOENT)." },
        { location: "no-identity", reason: "Package name is missing or invalid." },
        { location: "no-identity", reason: "Package version is missing or invalid." },
        { location: "undeclared", reason: "Declared license is missing or invalid." },
        {
          location: "undeclared/LICENSE",
          reason: "License or notice text is empty, binary, or invalid UTF-8.",
        },
        {
          location: "undeclared/COPYING",
          reason: "License or notice text is empty, binary, or invalid UTF-8.",
        },
        {
          location: "undeclared/NOTICE",
          reason: "License or notice candidate is not a regular file.",
        },
        {
          location: "undeclared/LICENSE.txt",
          reason: "Cannot read license or notice text (ENOENT).",
        },
        { location: "broken", reason: "Cannot resolve package (ENOENT)." },
        {
          location: "malformed/node_modules",
          reason: "Cannot resolve dependency directory (ENOENT).",
        },
      ]),
    );
  });

  it("writes inventory diagnostics, warns normally, and fails strict checks after writing", async () => {
    await packageAt(path.join(nodeModules, "missing"), "missing", "ISC", null);
    const output = path.join(fixture, "reports", "DEPENDENCY_LICENSES.md");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await generateDependencyLicenses({ nodeModules, output });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("1 inventory issues"));
    const report = await readFile(output, "utf8");
    expect(report).toContain("Inventory status: INCOMPLETE");
    expect(report).toContain('"missing": No readable package-root license text');
    expect(report).toContain("## missing@1.0.0");
    expect(report).toContain("Declared license: ISC");
    await rm(output);
    await expect(generateDependencyLicenses({ nodeModules, output, check: true })).rejects.toThrow(
      "1 inventory issues",
    );
    expect(await readFile(output, "utf8")).toBe(report);
  });

  it("passes strict checks and includes license texts for a complete inventory", async () => {
    await packageAt(path.join(nodeModules, "complete"), "complete");
    const output = path.join(fixture, "report.md");
    const inventory = await generateDependencyLicenses({ nodeModules, output, check: true });
    expect(inventory.issues).toEqual([]);
    const report = await readFile(output, "utf8");
    expect(report).toContain("1 physical packages inventoried; 0 inventory issues.");
    expect(report).toContain("Inventory status: COMPLETE");
    expect(report).toContain("Example license text");
  });

  it("fails strict audit when the install root cannot be read", async () => {
    await expect(
      generateDependencyLicenses({
        nodeModules: path.join(fixture, "absent"),
        output: path.join(fixture, "report.md"),
        check: true,
      }),
    ).rejects.toThrow("1 inventory issues");
    expect(await readFile(path.join(fixture, "report.md"), "utf8")).toContain(
      '".": Cannot resolve dependency directory (ENOENT).',
    );
  });
});
