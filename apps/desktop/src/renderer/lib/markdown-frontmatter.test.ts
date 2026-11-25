import { describe, expect, it } from "vitest";
import { splitMarkdownFrontmatter } from "./markdown-frontmatter";

describe("splitMarkdownFrontmatter", () => {
  it("splits flat properties and keeps the exact block for rewrites", () => {
    const text =
      '---\nname: review\ndescription: "Review a PR"\ntags:\n  - git\n  - pr\n---\n# Review\n';
    const { frontmatter, body } = splitMarkdownFrontmatter(text);
    expect(frontmatter?.properties).toEqual([
      { key: "name", value: "review" },
      { key: "description", value: "Review a PR" },
      { key: "tags", value: "git, pr" },
    ]);
    expect(body).toBe("# Review\n");
    // Task-checkbox edits rewrite the whole file from these two pieces.
    expect(`${frontmatter!.raw}${body}`).toBe(text);
  });

  it("shows nested or block YAML as source", () => {
    const { frontmatter } = splitMarkdownFrontmatter("---\nmeta:\n  owner: me\n---\nBody");
    expect(frontmatter).toMatchObject({ yaml: "meta:\n  owner: me", properties: null });
    expect(
      splitMarkdownFrontmatter("---\nnote: |\n  long\n---\n").frontmatter?.properties,
    ).toBeNull();
  });

  it("leaves documents without leading frontmatter alone", () => {
    expect(splitMarkdownFrontmatter("Intro\n---\nname: x\n---\n")).toEqual({
      frontmatter: null,
      body: "Intro\n---\nname: x\n---\n",
    });
  });
});
