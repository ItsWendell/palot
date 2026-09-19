import { readFile, writeFile } from "node:fs/promises";
import type {
  ContractComparison,
  ContractInventory,
  ContractOperation,
  EventPayload,
} from "./opencode-coverage-contract";
import { stableJson } from "./opencode-coverage-contract";
import type {
  EventEvidence,
  OperationEvidence,
  StaticAnalysis,
} from "./opencode-coverage-analysis";

export type CoverageDisposition = "integrated" | "not-integrated" | "planned" | "intentional-omit";

export interface CoverageBaseline {
  schemaVersion: 2;
  contractVersion: string;
  contractFingerprint: string;
  operations: Record<
    string,
    {
      disposition: CoverageDisposition;
      expectedProductionReference: boolean;
      note?: string;
    }
  >;
  events: Record<
    string,
    {
      expectedProductionMention: boolean;
      payloadFingerprint: string | null;
      note?: string;
    }
  >;
}

export interface CoverageIssue {
  code:
    | "alignment"
    | "contract-version"
    | "contract-change"
    | "new-operation"
    | "removed-operation"
    | "lost-operation-evidence"
    | "new-event"
    | "removed-event"
    | "lost-event-evidence"
    | "changed-event-payload"
    | "event-payload-unavailable"
    | "analyzer-diagnostic";
  message: string;
}

export interface CoverageReportOperation extends Omit<ContractOperation, "contractShape"> {
  evidence: OperationEvidence;
  baseline: CoverageBaseline["operations"][string] | null;
  observedRequestCoverage: {
    observed: number;
    available: number;
    missing: string[];
    percent: number | null;
    complete: boolean;
  };
}

export interface CoverageReport {
  schemaVersion: 2;
  contract: {
    version: string;
    fingerprint: string;
    operations: number;
    experimentalOperations: number;
    eventTypes: number;
    alignedPackages: Record<string, string>;
    resolutionPaths: Record<string, string>;
  };
  summary: {
    operationsWithProductionReferences: number;
    operationsWithTestReferences: number;
    operationsWithE2EReferences: number;
    unobservedOperations: number;
    productionReferencePercent: number;
    eventsWithProductionMentions: number;
    unobservedEvents: number;
    eventMentionPercent: number;
  };
  groups: Array<{
    group: string;
    operations: number;
    productionReferences: number;
    testReferences: number;
    e2eReferences: number;
    percent: number;
  }>;
  operations: CoverageReportOperation[];
  events: Array<
    EventEvidence & {
      baseline: CoverageBaseline["events"][string] | null;
      payload: EventPayload | null;
    }
  >;
  comparisons: ContractComparison[];
  issues: CoverageIssue[];
  diagnostics: string[];
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 100 : Math.round((numerator / denominator) * 10_000) / 100;
}

export function createBaseline(
  contract: ContractInventory,
  analysis: StaticAnalysis,
  previous?: CoverageBaseline,
): CoverageBaseline {
  const evidenceByOperation = new Map(
    analysis.operations.map((operation) => [operation.operationID, operation]),
  );
  const events = new Map(analysis.events.map((event) => [event.type, event]));
  return {
    schemaVersion: 2,
    contractVersion: contract.version,
    contractFingerprint: contract.fingerprint,
    operations: Object.fromEntries(
      contract.operations.map((operation) => {
        const evidence = evidenceByOperation.get(operation.operationID);
        // 2.0.4 dropped the v2 prefix and moved several existing operations to
        // experimental IDs. Keep reviewed dispositions when recording that migration.
        const previousIDs = [
          operation.operationID,
          `v2.${operation.operationID}`,
          `v2.${operation.operationID.replace(/^experimental\./, "")}`,
          ...(operation.operationID === "session.message.get" ? ["v2.session.message"] : []),
        ];
        const old = previousIDs.map((id) => previous?.operations[id]).find(Boolean);
        const observed = Boolean(evidence?.productionCalls);
        return [
          operation.operationID,
          {
            disposition:
              old?.disposition === "planned" || old?.disposition === "intentional-omit"
                ? old.disposition
                : observed
                  ? "integrated"
                  : "not-integrated",
            expectedProductionReference: observed,
            ...(old?.note ? { note: old.note } : {}),
          },
        ];
      }),
    ),
    events: Object.fromEntries(
      analysis.eventTypes.map((type) => {
        const evidence = events.get(type);
        const old = previous?.events[type];
        return [
          type,
          {
            expectedProductionMention: Boolean(evidence?.productionMentions),
            payloadFingerprint: contract.eventPayloads?.[type]?.fingerprint ?? null,
            ...(old?.note ? { note: old.note } : {}),
          },
        ];
      }),
    ),
  };
}

export async function readBaseline(file: string): Promise<CoverageBaseline | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as CoverageBaseline;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export async function writeBaseline(file: string, baseline: CoverageBaseline): Promise<void> {
  await writeFile(file, `${stableJson(baseline, 2)}\n`);
}

export function checkCoverage(input: {
  contract: ContractInventory;
  analysis: StaticAnalysis;
  baseline: CoverageBaseline | null;
  alignedPackages: Record<string, string>;
  resolutionPaths?: Record<string, string>;
}): CoverageIssue[] {
  const issues: CoverageIssue[] = [];
  for (const diagnostic of input.analysis.diagnostics) {
    issues.push({ code: "analyzer-diagnostic", message: diagnostic });
  }
  const packageVersions = new Set(Object.values(input.alignedPackages));
  if (packageVersions.size !== 1 || !packageVersions.has(input.contract.version)) {
    issues.push({
      code: "alignment",
      message: `OpenCode package versions are not aligned: ${Object.entries(input.alignedPackages)
        .map(
          ([name, version]) =>
            `${name}=${version}${input.resolutionPaths?.[name] ? ` (${input.resolutionPaths[name]})` : ""}`,
        )
        .join(", ")}.`,
    });
  }
  const baseline = input.baseline;
  if (
    !input.contract.eventPayloads ||
    input.contract.eventTypes.some((type) => !input.contract.eventPayloads?.[type])
  ) {
    issues.push({
      code: "event-payload-unavailable",
      message:
        "Decoded event payload contracts are unavailable; use the published client declarations, not only an OpenAPI document or event names.",
    });
  }
  if (!baseline) {
    issues.push({ code: "contract-change", message: "Coverage baseline is missing." });
    return issues;
  }
  if (baseline.contractVersion !== input.contract.version) {
    issues.push({
      code: "contract-version",
      message: `Coverage baseline targets ${baseline.contractVersion}, installed contract is ${input.contract.version}.`,
    });
  }
  if (
    baseline.schemaVersion !== 2 ||
    Object.values(baseline.events).some((event) => !event.payloadFingerprint)
  ) {
    issues.push({
      code: "event-payload-unavailable",
      message:
        "The baseline has no reviewed decoded event payloads. Inspect the report and regenerate with --update-baseline --reviewed <fingerprint>.",
    });
  }
  for (const [type, payload] of Object.entries(input.contract.eventPayloads ?? {})) {
    const previous = baseline.events[type]?.payloadFingerprint;
    if (previous && previous !== payload.fingerprint)
      issues.push({
        code: "changed-event-payload",
        message: `Decoded OpenCode event payload changed: ${type}.`,
      });
  }
  if (baseline.contractFingerprint !== input.contract.fingerprint) {
    issues.push({
      code: "contract-change",
      message: "The installed OpenCode contract differs from the reviewed baseline.",
    });
  }
  const currentOperations = new Set(
    input.contract.operations.map((operation) => operation.operationID),
  );
  for (const operationID of currentOperations) {
    if (!baseline.operations[operationID]) {
      issues.push({ code: "new-operation", message: `New OpenCode operation: ${operationID}.` });
    }
  }
  for (const operationID of Object.keys(baseline.operations)) {
    if (!currentOperations.has(operationID)) {
      issues.push({
        code: "removed-operation",
        message: `Removed OpenCode operation: ${operationID}.`,
      });
    }
  }
  const evidenceByOperation = new Map(
    input.analysis.operations.map((operation) => [operation.operationID, operation]),
  );
  for (const [operationID, expectation] of Object.entries(baseline.operations)) {
    if (
      currentOperations.has(operationID) &&
      expectation.expectedProductionReference &&
      (evidenceByOperation.get(operationID)?.productionCalls ?? 0) === 0
    ) {
      issues.push({
        code: "lost-operation-evidence",
        message: `${operationID} lost its production reference.`,
      });
    }
  }
  const currentEvents = new Set(input.analysis.eventTypes);
  for (const type of currentEvents) {
    if (!baseline.events[type])
      issues.push({ code: "new-event", message: `New OpenCode event: ${type}.` });
  }
  for (const type of Object.keys(baseline.events)) {
    if (!currentEvents.has(type))
      issues.push({ code: "removed-event", message: `Removed OpenCode event: ${type}.` });
  }
  const evidenceByEvent = new Map(input.analysis.events.map((event) => [event.type, event]));
  for (const [type, expectation] of Object.entries(baseline.events)) {
    if (
      currentEvents.has(type) &&
      expectation.expectedProductionMention &&
      (evidenceByEvent.get(type)?.productionMentions ?? 0) === 0
    ) {
      issues.push({
        code: "lost-event-evidence",
        message: `${type} lost its production mention.`,
      });
    }
  }
  return issues.toSorted(
    (left, right) =>
      left.code.localeCompare(right.code) || left.message.localeCompare(right.message),
  );
}

export function buildCoverageReport(input: {
  contract: ContractInventory;
  analysis: StaticAnalysis;
  baseline: CoverageBaseline | null;
  alignedPackages: Record<string, string>;
  resolutionPaths?: Record<string, string>;
  comparisons: ContractComparison[];
}): CoverageReport {
  const issues = checkCoverage(input);
  const evidenceByOperation = new Map(
    input.analysis.operations.map((operation) => [operation.operationID, operation]),
  );
  const operations = input.contract.operations.map((operation) => {
    const { contractShape: _contractShape, ...reportedOperation } = operation;
    const evidence = evidenceByOperation.get(operation.operationID);
    if (!evidence) throw new Error(`Missing analysis record for ${operation.operationID}.`);
    const observed = operation.inputFields.filter((field) =>
      evidence.requestFieldsObserved.includes(field),
    );
    const missing = operation.inputFields.filter(
      (field) => !evidence.requestFieldsObserved.includes(field),
    );
    return {
      ...reportedOperation,
      evidence,
      baseline: input.baseline?.operations[operation.operationID] ?? null,
      observedRequestCoverage: {
        observed: observed.length,
        available: operation.inputFields.length,
        missing,
        complete: evidence.requestCoverageComplete,
        percent:
          operation.inputFields.length === 0 || !evidence.requestCoverageComplete
            ? null
            : percentage(observed.length, operation.inputFields.length),
      },
    };
  });
  const events = input.analysis.events.map((event) => ({
    ...event,
    baseline: input.baseline?.events[event.type] ?? null,
    payload: input.contract.eventPayloads?.[event.type] ?? null,
  }));
  const groups = [...new Set(operations.map((operation) => operation.group))]
    .map((group) => {
      const members = operations.filter((operation) => operation.group === group);
      const productionReferences = members.filter(
        (operation) => operation.evidence.productionCalls > 0,
      ).length;
      return {
        group,
        operations: members.length,
        productionReferences,
        testReferences: members.filter(
          (operation) =>
            operation.evidence.unitTestCalls > 0 || operation.evidence.mockDefinitions > 0,
        ).length,
        e2eReferences: members.filter((operation) => operation.evidence.e2eCalls > 0).length,
        percent: percentage(productionReferences, members.length),
      };
    })
    .toSorted((left, right) => left.group.localeCompare(right.group));
  const operationsWithProductionReferences = operations.filter(
    (operation) => operation.evidence.productionCalls > 0,
  ).length;
  const eventsWithProductionMentions = events.filter(
    (event) => event.productionMentions > 0,
  ).length;
  return {
    schemaVersion: 2,
    contract: {
      version: input.contract.version,
      fingerprint: input.contract.fingerprint,
      operations: operations.length,
      experimentalOperations: operations.filter((operation) => operation.experimental).length,
      eventTypes: events.length,
      alignedPackages: input.alignedPackages,
      resolutionPaths: input.resolutionPaths ?? {},
    },
    summary: {
      operationsWithProductionReferences,
      operationsWithTestReferences: operations.filter(
        (operation) =>
          operation.evidence.unitTestCalls > 0 || operation.evidence.mockDefinitions > 0,
      ).length,
      operationsWithE2EReferences: operations.filter((operation) => operation.evidence.e2eCalls > 0)
        .length,
      unobservedOperations: operations.length - operationsWithProductionReferences,
      productionReferencePercent: percentage(operationsWithProductionReferences, operations.length),
      eventsWithProductionMentions,
      unobservedEvents: events.length - eventsWithProductionMentions,
      eventMentionPercent: percentage(eventsWithProductionMentions, events.length),
    },
    groups,
    operations,
    events,
    comparisons: input.comparisons,
    issues,
    diagnostics: input.analysis.diagnostics,
  };
}

function operationList(operations: CoverageReportOperation[]): string {
  if (operations.length === 0) return "None.";
  return operations
    .map((operation) => {
      const test =
        operation.evidence.unitTestCalls > 0 || operation.evidence.mockDefinitions > 0
          ? "unit"
          : "none";
      const e2e = operation.evidence.e2eCalls > 0 ? "yes" : "no";
      return `- \`${operation.operationID}\` ${operation.method} \`${operation.path}\`, production calls ${operation.evidence.productionCalls}, tests ${test}, E2E ${e2e}`;
    })
    .join("\n");
}

export function markdownReport(report: CoverageReport): string {
  const unobserved = report.operations.filter(
    (operation) => operation.evidence.productionCalls === 0,
  );
  const experimental = report.operations.filter((operation) => operation.experimental);
  const shallow = report.operations.filter(
    (operation) =>
      operation.evidence.productionCalls > 0 &&
      operation.evidence.unitTestCalls === 0 &&
      operation.evidence.mockDefinitions === 0 &&
      operation.evidence.e2eCalls === 0,
  );
  const lines = [
    "# OpenCode coverage report",
    "",
    `Contract: \`${report.contract.version}\``,
    "",
    `- ${report.contract.operations} operations, ${report.contract.experimentalOperations} experimental`,
    `- ${report.summary.operationsWithProductionReferences} operations have production references (${report.summary.productionReferencePercent}%)`,
    `- ${report.summary.operationsWithTestReferences} operations have unit-test references or mocks`,
    `- ${report.summary.operationsWithE2EReferences} operations appear in deterministic E2E code`,
    `- ${report.summary.eventsWithProductionMentions} of ${report.contract.eventTypes} event variants are mentioned in production (${report.summary.eventMentionPercent}%)`,
    "",
    "## Contract check",
    "",
    ...(report.issues.length === 0
      ? ["Pass. The installed contract and reviewed baseline agree."]
      : report.issues.map((issue) => `- [${issue.code}] ${issue.message}`)),
    "",
    "## Coverage by API group",
    "",
    "| Group | Operations | Production | Unit | E2E | Production % |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...report.groups.map(
      (group) =>
        `| ${group.group} | ${group.operations} | ${group.productionReferences} | ${group.testReferences} | ${group.e2eReferences} | ${group.percent}% |`,
    ),
    "",
    "## Experimental operations",
    "",
    operationList(experimental),
    "",
    "## Integrated without direct test evidence",
    "",
    operationList(shallow),
    "",
    "## No production reference",
    "",
    operationList(unobserved),
  ];
  for (const comparison of report.comparisons) {
    lines.push(
      "",
      `## Comparison with ${comparison.source} ${comparison.version}`,
      "",
      `- Added: ${comparison.added.length}`,
      `- Removed: ${comparison.removed.length}`,
      `- Changed: ${comparison.changed.length}`,
      `- Added events: ${comparison.addedEvents.length}`,
      `- Removed events: ${comparison.removedEvents.length}`,
      `- Changed event payloads: ${comparison.eventPayloadComparison === "available" ? comparison.changedEvents.length : "unavailable (decoded declarations required)"}`,
      ...comparison.changedEvents.map(
        (type) => `- Changed payload: \`${type}\` (full before/after in JSON)`,
      ),
      "",
      ...(comparison.added.length > 0
        ? ["Added operations:", "", ...comparison.added.map((item) => `- \`${item}\``)]
        : []),
      ...(comparison.removed.length > 0
        ? ["", "Removed operations:", "", ...comparison.removed.map((item) => `- \`${item}\``)]
        : []),
      ...(comparison.changed.length > 0
        ? ["", "Changed operations:", "", ...comparison.changed.map((item) => `- \`${item}\``)]
        : []),
      ...(comparison.addedEvents.length > 0
        ? ["", "Added events:", "", ...comparison.addedEvents.map((item) => `- \`${item}\``)]
        : []),
      ...(comparison.removedEvents.length > 0
        ? ["", "Removed events:", "", ...comparison.removedEvents.map((item) => `- \`${item}\``)]
        : []),
    );
  }
  if (report.diagnostics.length > 0) {
    lines.push("", "## Analyzer diagnostics", "", ...report.diagnostics.map((item) => `- ${item}`));
  }
  return `${lines.join("\n")}\n`;
}
