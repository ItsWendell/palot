import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCoveragePackages } from "./opencode-coverage-resolution";
import { analyzeOpenCodeUsage, readPackageVersion } from "./opencode-coverage-analysis";
import {
  compareContracts,
  contractFromFile,
  installedContract,
  publishedContract,
  stableJson,
  type ContractComparison,
} from "./opencode-coverage-contract";
import {
  buildCoverageReport,
  createBaseline,
  markdownReport,
  readBaseline,
  writeBaseline,
} from "./opencode-coverage-report";

interface Options {
  check: boolean;
  updateBaseline: boolean;
  json: string;
  markdown: string;
  compare: Array<"beta" | "dev">;
  sourceOpenApi: string | null;
  reviewed: string | null;
}

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = path.resolve(APP_ROOT, "../..");
const LOCAL_ROOT = path.join(WORKSPACE_ROOT, ".local/opencode-coverage");
const BASELINE_FILE = path.join(APP_ROOT, "opencode-coverage-baseline.json");

function optionValue(args: string[], index: number, name: string): string {
  const argument = args[index];
  const inline = argument?.slice(name.length + 1);
  if (inline) return inline;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`${name} requires a value.`);
  return next;
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    check: false,
    updateBaseline: false,
    json: path.join(LOCAL_ROOT, "report.json"),
    markdown: path.join(LOCAL_ROOT, "report.md"),
    compare: [],
    sourceOpenApi: null,
    reviewed: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--update-baseline") options.updateBaseline = true;
    else if (argument === "--reviewed" || argument?.startsWith("--reviewed=")) {
      options.reviewed = optionValue(args, index, "--reviewed");
      if (argument === "--reviewed") index += 1;
    } else if (argument === "--json" || argument?.startsWith("--json=")) {
      options.json = path.resolve(optionValue(args, index, "--json"));
      if (argument === "--json") index += 1;
    } else if (argument === "--markdown" || argument?.startsWith("--markdown=")) {
      options.markdown = path.resolve(optionValue(args, index, "--markdown"));
      if (argument === "--markdown") index += 1;
    } else if (argument === "--compare" || argument?.startsWith("--compare=")) {
      const values = optionValue(args, index, "--compare").split(",");
      if (argument === "--compare") index += 1;
      for (const value of values) {
        if (value !== "beta" && value !== "dev")
          throw new Error(`Unknown comparison channel: ${value}`);
        if (!options.compare.includes(value)) options.compare.push(value);
      }
    } else if (argument === "--source-openapi" || argument?.startsWith("--source-openapi=")) {
      options.sourceOpenApi = path.resolve(optionValue(args, index, "--source-openapi"));
      if (argument === "--source-openapi") index += 1;
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Usage: bun run opencode:coverage [options]

Options:
  --check                  Exit non-zero when the reviewed baseline fails
  --update-baseline        Record a reviewed contract and static evidence
  --reviewed <fingerprint> Required for an existing baseline update
  --compare beta,dev       Compare with aligned published OpenCode channels
  --source-openapi <file>  Compare with another OpenAPI document
  --json <file>            JSON report path
  --markdown <file>        Markdown report path`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

async function supportedVersion(): Promise<string> {
  const source = await readFile(path.join(APP_ROOT, "src/main/opencode-version.ts"), "utf8");
  const match = source.match(/SUPPORTED_OPENCODE_VERSION\s*=\s*"([^"]+)"/);
  if (!match?.[1]) throw new Error("Could not read SUPPORTED_OPENCODE_VERSION.");
  return match[1];
}

async function alignedPackages(): Promise<Record<string, string>> {
  return {
    client: await readPackageVersion(path.join(APP_ROOT, "package.json"), "@opencode/client"),
    protocol: await readPackageVersion(path.join(APP_ROOT, "package.json"), "@opencode/protocol"),
    ...resolveCoveragePackages().versions,
    supported: await supportedVersion(),
  };
}

async function comparisons(
  options: Options,
  contract: ReturnType<typeof installedContract>,
): Promise<ContractComparison[]> {
  const published = options.compare.map(async (channel) =>
    compareContracts(
      contract,
      await publishedContract({
        channel,
        cacheDirectory: path.join(LOCAL_ROOT, "contracts"),
      }),
    ),
  );
  const source = options.sourceOpenApi
    ? [
        contractFromFile(options.sourceOpenApi, `source:${options.sourceOpenApi}`).then(
          (candidate) => compareContracts(contract, candidate),
        ),
      ]
    : [];
  return (await Promise.all([...published, ...source])).toSorted((left, right) =>
    left.source.localeCompare(right.source),
  );
}

async function writeReport(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.check && options.updateBaseline) {
    throw new Error("--check and --update-baseline cannot run together.");
  }
  const versions = await alignedPackages();
  const contract = installedContract(versions.resolvedProtocol ?? "unknown");
  const [analysis, compared, previousBaseline] = await Promise.all([
    analyzeOpenCodeUsage({ appRoot: APP_ROOT, workspaceRoot: WORKSPACE_ROOT, contract }),
    comparisons(options, contract),
    readBaseline(BASELINE_FILE),
  ]);
  const review = buildCoverageReport({
    contract,
    analysis,
    baseline: previousBaseline,
    alignedPackages: versions,
    resolutionPaths: resolveCoveragePackages().paths,
    comparisons: compared,
  });
  let baseline = previousBaseline;
  if (options.updateBaseline) {
    const blocking = review.issues.filter(
      (issue) =>
        issue.code === "alignment" ||
        issue.code === "lost-operation-evidence" ||
        issue.code === "lost-event-evidence" ||
        issue.code === "analyzer-diagnostic",
    );
    if (blocking.length > 0) {
      throw new Error(
        `Baseline update is blocked: ${blocking.map((issue) => issue.message).join(" ")}`,
      );
    }
    if (options.reviewed !== contract.fingerprint) {
      throw new Error(
        `Baseline update requires --reviewed ${contract.fingerprint} after inspecting the current report.`,
      );
    }
    if (previousBaseline) {
      await Promise.all([
        writeReport(
          path.join(LOCAL_ROOT, "review-before-update.json"),
          `${stableJson(review, 2)}\n`,
        ),
        writeReport(path.join(LOCAL_ROOT, "review-before-update.md"), markdownReport(review)),
      ]);
    }
    baseline = createBaseline(contract, analysis, previousBaseline ?? undefined);
    await writeBaseline(BASELINE_FILE, baseline);
  }
  const report = options.updateBaseline
    ? buildCoverageReport({
        contract,
        analysis,
        baseline,
        alignedPackages: versions,
        resolutionPaths: resolveCoveragePackages().paths,
        comparisons: compared,
      })
    : review;
  await Promise.all([
    writeReport(options.json, `${stableJson(report, 2)}\n`),
    writeReport(options.markdown, markdownReport(report)),
  ]);
  console.log(
    [
      `OpenCode ${report.contract.version}: ${report.contract.operations} operations, ${report.contract.eventTypes} events`,
      `Production references: ${report.summary.operationsWithProductionReferences}/${report.contract.operations} (${report.summary.productionReferencePercent}%)`,
      `Event mentions: ${report.summary.eventsWithProductionMentions}/${report.contract.eventTypes} (${report.summary.eventMentionPercent}%)`,
      `Contract check: ${report.issues.length === 0 ? "pass" : `${report.issues.length} issue(s)`}`,
      ...report.issues.map((issue) => `[${issue.code}] ${issue.message}`),
      ...report.comparisons.map(
        (comparison) =>
          `${comparison.source}: ${comparison.changedEvents.length} changed event payloads (${comparison.eventPayloadComparison})`,
      ),
      `JSON: ${path.relative(WORKSPACE_ROOT, options.json)}`,
      `Markdown: ${path.relative(WORKSPACE_ROOT, options.markdown)}`,
    ].join("\n"),
  );
  if (options.check && report.issues.length > 0) process.exitCode = 1;
}

if (import.meta.main) await main();
