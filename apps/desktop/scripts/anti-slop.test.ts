// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const directories: string[] = [];
let sourceDirectory: string;
let testDirectory: string;

beforeAll(async () => {
  // These must live in the checkout: the real root config has path-based overrides.
  sourceDirectory = await mkdtemp(path.join(workspaceRoot, "anti-slop-fixtures-"));
  directories.push(sourceDirectory);
  testDirectory = await mkdtemp(path.join(workspaceRoot, "apps/desktop/test/anti-slop-fixtures-"));
  directories.push(testDirectory);
});

afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

interface LintReport {
  diagnostics: { code: string; severity: string; filename: string }[];
  number_of_files: number;
}

async function lintFixtures(fixtures: { directory?: string; name: string; code: string }[]) {
  const files = await Promise.all(
    fixtures.map(async ({ directory = sourceDirectory, name, code }) => {
      const filename = path.join(directory, name);
      await writeFile(filename, code);
      return path.relative(workspaceRoot, filename);
    }),
  );
  // Use Vite+'s actual config loader, not a reconstructed oxlint config or RuleTester.
  // Explicit paths prevent this subprocess from linting the suite or other fixtures.
  const result = spawnSync("vp", ["lint", "--format=json", "--threads=1", ...files], {
    cwd: workspaceRoot,
    encoding: "utf8",
    timeout: 20_000,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  expect(result.error, output).toBeUndefined();
  expect(result.signal, output).toBeNull();
  const report: LintReport = JSON.parse(result.stdout);
  // An ignored fixture must not masquerade as an accepted example.
  expect(report.number_of_files, output).toBe(fixtures.length);
  return { status: result.status, report, output };
}

const rejectedExamples = [
  {
    name: "object-copy.ts",
    code: "export const collect = (items) => items.reduce((acc, item) => Object.assign({}, acc, item), {});",
    rule: "anti-slop(no-reduce-accumulator-copy)",
  },
  {
    name: "array-copy.ts",
    code: "export const collect = (items) => items.reduce((acc, item) => acc.concat([item]), []);",
    rule: "anti-slop(no-reduce-accumulator-copy)",
  },
  {
    name: "widen.ts",
    code: "const source = { id: 'second' }; const widened: unknown = source; export const parsed = widened as { readonly id: string };",
    rule: "anti-slop(no-widen-then-assert)",
  },
  {
    name: "chained.ts",
    code: "declare const input: string; export const value = input as unknown as { id: string };",
    rule: "anti-slop(no-chained-type-assertions)",
  },
  {
    name: "parenthesized.ts",
    code: "declare const input: string; export const value = (input as unknown) as { id: string };",
    rule: "anti-slop(no-chained-type-assertions)",
  },
  {
    name: "spread.ts",
    code: "export const collect = (items) => items.reduce((acc, item) => [...acc, item], []);",
    rule: "oxc(no-accumulating-spread)",
  },
];

describe("vendored anti-slop through the project Vite+ lint CLI", () => {
  it("loads the plugin and rejects production examples at error severity", async () => {
    const { status, report, output } = await lintFixtures(rejectedExamples);
    expect(status, output).toBe(1);
    expect(
      report.diagnostics.map(({ code, severity, filename }) => ({
        name: path.basename(filename),
        rule: code,
        severity,
      })),
    ).toEqual(
      expect.arrayContaining(
        rejectedExamples.map(({ name, rule }) => ({ name, rule, severity: "error" })),
      ),
    );
    expect(report.diagnostics, output).toHaveLength(rejectedExamples.length);
  });

  it("accepts in-place accumulation, item copies, string concatenation, and boundary assertions", async () => {
    const { status, report, output } = await lintFixtures([
      {
        name: "accepted.ts",
        code: `
          export const collect = (items) => items.reduce((acc, item) => { acc.push(item); return acc; }, []);
          export const merge = (items) => items.reduce((acc, item) => Object.assign(acc, item), {});
          export const copyItems = (items) => items.reduce((acc, item) => { acc[item.id] = { ...item }; return acc; }, {});
          export const join = (items) => items.reduce((acc, item) => acc.concat(item), '');
          declare const input: unknown;
          export const parsed = input as { readonly id: string };
          const source = { id: 'first' };
          export const widened: unknown = source;
        `,
      },
    ]);
    expect(status, output).toBe(0);
    expect(report.diagnostics, output).toEqual([]);
  });

  it("permits chained assertions in test/spec files and desktop test helpers", async () => {
    const code =
      "declare const input: string; export const value = input as unknown as { id: string };";
    const { status, report, output } = await lintFixtures([
      { name: "double.test.ts", code },
      { name: "double.spec.ts", code },
      { name: "double.test.tsx", code },
      { name: "double.spec.tsx", code },
      { directory: testDirectory, name: "double-helper.ts", code },
    ]);
    expect(status, output).toBe(0);
    expect(report.diagnostics, output).toEqual([]);
  });

  it("keeps accumulation and widen-then-assert errors enabled in tests", async () => {
    const examples = rejectedExamples.filter(
      ({ rule }) => rule !== "anti-slop(no-chained-type-assertions)",
    );
    const { status, report, output } = await lintFixtures(
      examples.map((example) => ({
        ...example,
        directory: testDirectory,
        name: example.name.replace(".ts", ".test.ts"),
      })),
    );
    expect(status, output).toBe(1);
    expect(report.diagnostics.map(({ code }) => code).sort(), output).toEqual(
      examples.map(({ rule }) => rule).sort(),
    );
    expect(
      report.diagnostics.every(({ severity }) => severity === "error"),
      output,
    ).toBe(true);
  });
});
