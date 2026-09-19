import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { OpenCode } from "@opencode/client";
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
    expect(clientPathFromOperationID("session.form.reply")).toBe("session.form.reply");
    expect(clientPathFromOperationID("form.list")).toBe("form.list");
    expect(clientPathFromOperationID("session.permission.reply")).toBe("permission.reply");
    expect(clientPathFromOperationID("session.message.list")).toBe("message.list");
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
      contract.operations.find((item) => item.operationID === "pty.connect")?.promiseClient,
    ).toBe(false);
  });

  it("keeps global and session form evidence in separate client paths", () => {
    const contract = installedContract("test");
    expect(new Set(contract.operations.map((item) => item.clientPath)).size).toBe(
      contract.operations.length,
    );
    expect(contract.operations.find((item) => item.operationID === "form.list")?.clientPath).toBe(
      "form.list",
    );
    expect(
      contract.operations.find((item) => item.operationID === "session.form.list")?.clientPath,
    ).toBe("session.form.list");
  });

  it("maps every Promise operation to the published client without making requests", () => {
    const client = OpenCode.make({ baseUrl: "http://unused.invalid" });
    for (const operation of installedContract("test").operations) {
      if (!operation.promiseClient) continue;
      let member: unknown = client;
      for (const key of operation.clientPath.split(".")) {
        member =
          member && (typeof member === "object" || typeof member === "function")
            ? Reflect.get(member, key)
            : undefined;
      }
      expect(typeof member, operation.operationID).toBe("function");
    }
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

  it("tracks the required raw payload of binary upload operations", () => {
    const contract = inventoryFromOpenApi(
      {
        paths: {
          "/api/experimental/fs/write": {
            post: {
              operationId: "experimental.fs.write",
              requestBody: {
                required: true,
                content: {
                  "application/octet-stream": { schema: { type: "string", format: "binary" } },
                },
              },
              responses: { "200": {} },
            },
          },
        },
      },
      { version: "test", source: "test" },
    );
    expect(contract.operations[0]).toMatchObject({
      inputFields: ["payload"],
      requiredInputFields: ["payload"],
    });
  });

  it.each(["event.subscribe", "v2.event.subscribe"])(
    "reads event variants from %s OpenAPI streams",
    (operationId) => {
      const contract = inventoryFromOpenApi(
        {
          paths: {
            "/api/event": {
              get: {
                operationId,
                responses: {
                  "200": {
                    content: {
                      "text/event-stream": {
                        schema: {
                          properties: {
                            data: { properties: { type: { enum: ["location.shutdown"] } } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        { version: "test", source: "test" },
      );
      expect(contract.eventTypes).toEqual(["location.shutdown"]);
    },
  );

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

  it("preserves reviewed notes when recording renamed V2 operation IDs", () => {
    const previous = inventory("2.0.3", [operation("v2.session.skill"), operation("v2.agent.get")]);
    const baseline = createBaseline(previous, analysis(previous.operations));
    for (const record of Object.values(baseline.operations)) {
      record.disposition = "intentional-omit";
      record.note = "No product workflow needs this operation.";
    }
    const current = inventory("2.0.7", [
      operation("experimental.session.skill"),
      operation("agent.get"),
    ]);
    const updated = createBaseline(current, analysis(current.operations), baseline);
    expect(updated.operations["experimental.session.skill"]).toEqual(
      baseline.operations["v2.session.skill"],
    );
    expect(updated.operations["agent.get"]).toEqual(baseline.operations["v2.agent.get"]);
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
