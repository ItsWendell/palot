import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareContracts,
  eventContractFromDeclarations,
  inventoryFromOpenApi,
} from "./opencode-coverage-contract";
import { checkCoverage, createBaseline } from "./opencode-coverage-report";
import type { StaticAnalysis } from "./opencode-coverage-analysis";

describe("decoded event payload contracts", () => {
  it("detects a nested referenced union change without changing event names and gates the baseline", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "coverage-payload-"));
    try {
      const declarations = path.join(root, "types.d.ts");
      const source = (reasons: string) => `
        type Reason = ${reasons};
        type Details = { sessionID: string; reason: Reason; next?: Details };
        type SessionExecutionInterrupted = { type: "session.execution.interrupted"; data: Details };
        type ServerConnected = { type: "server.connected"; data: {} };
        type V2Event = SessionExecutionInterrupted | ServerConnected;
      `;
      const contract = async (reasons: string) => {
        await writeFile(declarations, source(reasons));
        return inventoryFromOpenApi(
          {},
          { version: "same", source: "test", ...eventContractFromDeclarations(declarations) },
        );
      };
      const current = await contract('"user" | "shutdown" | "superseded"');
      const candidate = await contract('"user" | "shutdown" | "superseded" | "inactivity"');
      const comparison = compareContracts(current, candidate);
      expect(comparison.addedEvents).toEqual([]);
      expect(comparison.changedEvents).toEqual(["session.execution.interrupted"]);
      expect(comparison.changedEventPayloads[0]?.candidate.shape).toMatchObject({
        references: { Reason: expect.any(Object), Details: expect.any(Object) },
      });
      expect(candidate.fingerprint).not.toBe(current.fingerprint);
      const analysis: StaticAnalysis = {
        operations: [],
        events: [],
        eventTypes: current.eventTypes,
        diagnostics: [],
      };
      const baseline = createBaseline(current, analysis);
      expect(
        checkCoverage({
          contract: candidate,
          analysis,
          baseline,
          alignedPackages: { client: "same" },
        }),
      ).toContainEqual({
        code: "changed-event-payload",
        message: "Decoded OpenCode event payload changed: session.execution.interrupted.",
      });
      await writeFile(
        declarations,
        "\n\n" + source('"user" | "shutdown" | "superseded" | "inactivity"').replaceAll(";", ";\n"),
      );
      expect(eventContractFromDeclarations(declarations).eventPayloads).toEqual(
        candidate.eventPayloads,
      );
      const namesOnly = { ...current, eventPayloads: null };
      expect(compareContracts(namesOnly, candidate).eventPayloadComparison).toBe("unavailable");
      const historical = JSON.parse(JSON.stringify(baseline));
      historical.schemaVersion = 1;
      for (const event of Object.values(historical.events) as Array<Record<string, unknown>>)
        delete event.payloadFingerprint;
      expect(
        checkCoverage({
          contract: current,
          analysis,
          baseline: historical,
          alignedPackages: { client: "same" },
        }).some((issue) => issue.code === "event-payload-unavailable"),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("actual ESM contract resolution", () => {
  it("reports desktop shadowing and protocol-relative dependencies instead of root versions", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "coverage-resolution-")));
    try {
      const install = async (base: string, name: string, version: string) => {
        const directory = path.join(base, "node_modules", name);
        await mkdir(directory, { recursive: true });
        await writeFile(
          path.join(directory, "package.json"),
          JSON.stringify({
            name,
            version,
            type: "module",
            exports: {
              ".": { import: "./index.js" },
              "./client": { import: "./index.js" },
              "./unstable/httpapi": { import: "./index.js" },
            },
          }),
        );
        await writeFile(path.join(directory, "index.js"), "export {};");
        return directory;
      };
      const desktop = path.join(root, "apps/desktop");
      for (const name of ["client", "protocol", "schema"])
        await install(root, `@opencode/${name}`, "19234");
      await install(root, "effect", "4");
      const client = await install(desktop, "@opencode/client", "19192");
      const protocol = await install(desktop, "@opencode/protocol", "19192");
      const schema = await install(protocol, "@opencode/schema", "19190");
      const script = path.join(desktop, "audit.ts");
      const module = path.resolve("scripts/opencode-coverage-resolution.ts");
      await writeFile(
        script,
        `import { resolveCoveragePackages } from ${JSON.stringify(module)}; console.log(JSON.stringify(resolveCoveragePackages(${JSON.stringify(script)})));`,
      );
      const result = JSON.parse(execFileSync("bun", [script], { encoding: "utf8" }));
      expect(result.versions).toMatchObject({
        resolvedClient: "19192",
        resolvedProtocol: "19192",
        resolvedClientProtocol: "19192",
        resolvedSchema: "19190",
      });
      expect(result.paths.resolvedClient).toBe(path.join(client, "package.json"));
      expect(result.paths.resolvedSchema).toBe(path.join(schema, "package.json"));
      expect(result.declarations).toBe(path.join(client, "generated/types.d.ts"));
      const contract = inventoryFromOpenApi(
        {},
        { version: "19192", source: "test", eventPayloads: {} },
      );
      const issues = checkCoverage({
        contract,
        analysis: { operations: [], events: [], eventTypes: [], diagnostics: [] },
        baseline: null,
        alignedPackages: { declared: "19234", ...result.versions },
        resolutionPaths: result.paths,
      });
      expect(issues.find((issue) => issue.code === "alignment")?.message).toContain(
        path.join(client, "package.json"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
