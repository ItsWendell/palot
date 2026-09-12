import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeOpenCodeUsage, type StaticAnalysis } from "./opencode-coverage-analysis";
import {
  clientPathFromOperationID,
  compareContracts,
  installedContract,
  inventoryFromOpenApi,
  type ContractInventory,
  type ContractOperation,
  type OpenApiDocument,
} from "./opencode-coverage-contract";
import { checkCoverage, createBaseline } from "./opencode-coverage-report";

const operation = (operationID: string, fingerprint = operationID): ContractOperation => ({
  operationID,
  clientPath: clientPathFromOperationID(operationID),
  method: "GET",
  path: `/api/${operationID}`,
  group: clientPathFromOperationID(operationID).split(".")[0] ?? "unknown",
  summary: null,
  description: null,
  experimental: false,
  promiseClient: true,
  streaming: false,
  inputFields: [],
  requiredInputFields: [],
  successStatuses: [200],
  errorStatuses: [],
  fingerprint,
  contractShape: { parameters: [], requestBody: null, responses: null, schemas: {} },
});

const inventory = (version: string, operations: ContractOperation[]): ContractInventory => ({
  version,
  source: "test",
  fingerprint: operations.map((item) => item.fingerprint).join(":"),
  operations,
  eventTypes: ["session.created"],
  eventPayloads: { "session.created": { fingerprint: "created", shape: {} } },
});

const analysis = (operations: ContractOperation[]): StaticAnalysis => ({
  operations: operations.map((item) => ({
    operationID: item.operationID,
    clientPath: item.clientPath,
    productionCalls: item.operationID.endsWith("list") ? 1 : 0,
    unitTestCalls: 0,
    e2eCalls: 0,
    mockDefinitions: 0,
    productionFiles: item.operationID.endsWith("list") ? ["src/list.ts"] : [],
    testFiles: [],
    requestFieldsObserved: [],
    requestCoverageComplete: true,
    responsePathsObserved: [],
    locations: [],
  })),
  events: [
    {
      type: "session.created",
      productionMentions: 1,
      unitTestMentions: 0,
      e2eMentions: 0,
      productionFiles: ["src/events.ts"],
      testFiles: [],
      locations: [],
    },
  ],
  eventTypes: ["session.created"],
  diagnostics: [],
});

describe("OpenCode coverage contract", () => {
  it("maps protocol operation IDs to Promise client paths", () => {
    expect(clientPathFromOperationID("v2.fs.read")).toBe("file.read");
    expect(clientPathFromOperationID("v2.session.form.reply")).toBe("form.reply");
    expect(clientPathFromOperationID("v2.session.permission.create")).toBe("permission.create");
    expect(clientPathFromOperationID("v2.experimental.integration.wellknown.add")).toBe(
      "integration.wellknown.add",
    );
    expect(clientPathFromOperationID("server.experimental.persistentPty.create")).toBe(
      "experimental.persistentPty.create",
    );
  });

  it("enumerates unique operations from the installed official contract", () => {
    const contract = installedContract("test");
    expect(contract.operations.length).toBeGreaterThan(0);
    expect(new Set(contract.operations.map((item) => item.operationID)).size).toBe(
      contract.operations.length,
    );
    expect(
      contract.operations.find((item) => item.operationID === "v2.pty.connect")?.promiseClient,
    ).toBe(false);
  });

  it("discovers stable global preferences and shells from the published protocol", () => {
    const contract = installedContract("test");
    const config = contract.operations.filter((item) => item.operationID.startsWith("v2.config."));
    expect(config).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationID: "v2.config.preferences",
          clientPath: "config.preferences",
          method: "GET",
          path: "/api/config/preferences",
          promiseClient: true,
          experimental: false,
          inputFields: [],
        }),
        expect.objectContaining({
          operationID: "v2.config.updatePreferences",
          clientPath: "config.updatePreferences",
          method: "PATCH",
          path: "/api/config/preferences",
          promiseClient: true,
          experimental: false,
          inputFields: ["shell", "websearch"],
          requiredInputFields: [],
        }),
        expect.objectContaining({
          operationID: "v2.config.shells",
          clientPath: "config.shells",
          method: "GET",
          path: "/api/config/shell",
          promiseClient: true,
          experimental: false,
          inputFields: [],
        }),
      ]),
    );
    expect(contract.operations.find((item) => item.operationID === "v2.fs.read")).toMatchObject({
      successStatuses: [200],
      errorStatuses: [400, 401, 404],
    });
  });

  it("reports added, removed, and changed operations", () => {
    const current = inventory("one", [operation("v2.session.list"), operation("v2.session.get")]);
    const candidate = inventory("two", [
      operation("v2.session.list", "changed"),
      operation("v2.session.create"),
    ]);
    expect(compareContracts(current, candidate)).toMatchObject({
      added: ["v2.session.create"],
      removed: ["v2.session.get"],
      changed: ["v2.session.list"],
    });
  });

  it("fingerprints schemas reached through OpenAPI references", () => {
    const document = (required: string[]): OpenApiDocument => ({
      paths: {
        "/api/form": {
          post: {
            operationId: "v2.session.form.reply",
            requestBody: {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/FormReply" } },
              },
            },
            responses: { "204": {} },
          },
        },
      },
      components: {
        schemas: {
          FormReply: {
            type: "object",
            properties: { answer: { type: "string" }, metadata: { type: "object" } },
            required,
          },
        },
      },
    });
    const current = inventoryFromOpenApi(document(["answer"]), {
      version: "one",
      source: "test",
    });
    const candidate = inventoryFromOpenApi(document(["answer", "metadata"]), {
      version: "two",
      source: "test",
    });
    expect(compareContracts(current, candidate).changed).toEqual(["v2.session.form.reply"]);
  });
});

describe("OpenCode coverage baseline", () => {
  it("reports retired contract entries without treating them as lost integration evidence", () => {
    const previous = inventory("one", [operation("v2.session.list")]);
    const baseline = createBaseline(previous, analysis(previous.operations));
    const contract = { ...inventory("one", []), eventTypes: [], eventPayloads: {} };
    const current = { ...analysis([]), eventTypes: [], events: [] };
    const input = {
      contract,
      analysis: current,
      baseline,
      alignedPackages: { client: "one", protocol: "one", schema: "one", supported: "one" },
    };

    expect(checkCoverage(input).map((issue) => issue.code)).toEqual([
      "contract-change",
      "removed-event",
      "removed-operation",
    ]);
    expect(
      checkCoverage({ ...input, baseline: createBaseline(contract, current, baseline) }),
    ).toEqual([]);
  });

  it("fails when reviewed operations or event evidence disappear", () => {
    const contract = inventory("one", [operation("v2.session.list")]);
    const current = analysis(contract.operations);
    const baseline = createBaseline(contract, current);
    current.operations[0]!.productionCalls = 0;
    current.events[0]!.productionMentions = 0;
    expect(
      checkCoverage({
        contract,
        analysis: current,
        baseline,
        alignedPackages: { client: "one", protocol: "one", schema: "one", supported: "one" },
      }).map((issue) => issue.code),
    ).toEqual(["lost-event-evidence", "lost-operation-evidence"]);
  });
});

describe("OpenCode static evidence", () => {
  it("recognizes custom transport paths and cast client mocks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "palot-coverage-test-"));
    try {
      await Promise.all(
        ["src", "scripts", "test"].map((directory) =>
          mkdir(path.join(root, directory), { recursive: true }),
        ),
      );
      await writeFile(
        path.join(root, "src/custom.ts"),
        "const url = `/api/pty/${encodeURIComponent(id)}/connect`;\n",
      );
      await writeFile(
        path.join(root, "test/client.test.ts"),
        "const value = { event: { subscribe() {} } } as unknown as OpenCodeClient;\n",
      );
      const custom = {
        ...operation("v2.pty.connect"),
        path: "/api/pty/{ptyID}/connect",
        promiseClient: false,
      };
      const subscribe = operation("v2.event.subscribe");
      const result = await analyzeOpenCodeUsage({
        appRoot: root,
        workspaceRoot: root,
        contract: inventory("one", [custom, subscribe]),
      });
      expect(
        result.operations.find((item) => item.operationID === custom.operationID)?.productionCalls,
      ).toBe(1);
      expect(
        result.operations.find((item) => item.operationID === subscribe.operationID)
          ?.mockDefinitions,
      ).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
