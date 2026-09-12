import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPublicDocs, markdownFileLinks } from "./check-public-docs";

const roots: string[] = [];
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "palot-public-docs-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("public documentation boundaries", () => {
  it("resolves relative links, images, references and public directories", async () => {
    const files = {
      "README.md":
        "[Setup](docs/setup.md#linux) ![Cover](docs/cover.png) [Docs](docs/)\n[guide]: docs/setup.md",
      "docs/setup.md":
        "[Home](../README.md) [Remote](https://example.com/) [Mail](mailto:maintainer@example.com)",
      "docs/cover.png": "image fixture",
    };
    expect(await checkPublicDocs(await fixture(files), Object.keys(files))).toEqual([]);
  });

  it("does not let an ignored file satisfy a public documentation link", async () => {
    const root = await fixture({
      "README.md": "[Setup](docs/generated.md)",
      "docs/generated.md": "local only",
    });
    expect(await checkPublicDocs(root, ["README.md"])).toEqual([
      "README.md: missing public target docs/generated.md",
    ]);
  });

  it("rejects private, encoded private, and machine-local destinations even when present", async () => {
    const root = await fixture({
      "docs/setup.md":
        "[Private](../.private/plan.md) [Encoded](../%2eprivate/plan.md) [Local](/home/user/plan.md)",
    });
    expect(await checkPublicDocs(root, ["docs/setup.md"])).toHaveLength(3);
  });

  it("rejects accidental tracked private archives and internal public plans", async () => {
    const files = { "nested/.private/plan.md": "private", "docs/plans/plan.md": "internal" };
    expect(await checkPublicDocs(await fixture(files), Object.keys(files))).toEqual([
      "nested/.private/plan.md: private artifact included in Git",
      "docs/plans/plan.md: internal documentation is public",
    ]);
  });

  it("ignores code examples and comments, but checks prose HTML images", () => {
    expect(
      markdownFileLinks(
        '```md\n[Example](missing.md)\n```\n`[Example](missing.md)`\n<!-- [Hidden](missing.md) -->\n<img src="docs/cover.png">',
      ),
    ).toEqual(["docs/cover.png"]);
  });

  it("reports links to deleted files and malformed encodings", async () => {
    const root = await fixture({ "README.md": "[Deleted](old.md) [Invalid](%XX.md)" });
    expect(await checkPublicDocs(root, ["README.md", "old.md"])).toEqual([
      "README.md: missing public target old.md",
      "README.md: malformed link %XX.md",
    ]);
  });

  it("does not treat footnote prose or removed archives as live file links", async () => {
    const root = await fixture({
      "README.md": "A note[^note].\n\n[^note]: This explains a [guide](docs/guide.md).",
      "docs/guide.md": "Guide",
    });
    expect(await checkPublicDocs(root, ["README.md", "docs/guide.md", ".audit/old.tsv"])).toEqual(
      [],
    );
  });
});
