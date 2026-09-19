import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ClientApi, promiseOmitEndpoints } from "@opencode/protocol/client";
import { parseSync, visitorKeys, type Node, type TSTypeAliasDeclaration } from "oxc-parser";
import { resolveCoveragePackages } from "./opencode-coverage-resolution";

const resolvedPackages = resolveCoveragePackages();
const { OpenApi } = await import(resolvedPackages.effectOpenApi);

const execFileAsync = promisify(execFile);
const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"];

export interface JsonSchema {
  $ref?: string;
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  items?: JsonSchema;
  enum?: unknown[];
  [key: string]: unknown;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{ name?: string; in?: string; required?: boolean; schema?: JsonSchema }>;
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: JsonSchema }>;
  };
  responses?: Record<
    string,
    {
      content?: Record<string, { schema?: JsonSchema }>;
    }
  >;
  [key: string]: unknown;
}

export interface OpenApiDocument {
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, JsonSchema> };
  [key: string]: unknown;
}

export interface ContractOperation {
  operationID: string;
  clientPath: string;
  method: string;
  path: string;
  group: string;
  summary: string | null;
  description: string | null;
  experimental: boolean;
  promiseClient: boolean;
  streaming: boolean;
  inputFields: string[];
  requiredInputFields: string[];
  successStatuses: number[];
  errorStatuses: number[];
  fingerprint: string;
  contractShape: {
    parameters: OpenApiOperation["parameters"];
    requestBody: OpenApiOperation["requestBody"] | null;
    responses: OpenApiOperation["responses"] | null;
    schemas: Record<string, JsonSchema>;
  };
}

export interface ContractInventory {
  version: string;
  source: string;
  fingerprint: string;
  operations: ContractOperation[];
  eventTypes: string[];
  eventPayloads: Record<string, EventPayload> | null;
}

export interface EventPayload {
  fingerprint: string;
  shape: unknown;
}

export interface ContractComparison {
  source: string;
  version: string;
  fingerprint: string;
  added: string[];
  removed: string[];
  changed: string[];
  addedEvents: string[];
  removedEvents: string[];
  changedEvents: string[];
  eventPayloadComparison: "available" | "unavailable";
  changedEventPayloads: Array<{ type: string; current: EventPayload; candidate: EventPayload }>;
  addedOperations: ContractOperation[];
  removedOperations: ContractOperation[];
  changedOperations: Array<{
    operationID: string;
    current: ContractOperation;
    candidate: ContractOperation;
  }>;
}

export function stableJson(value: unknown, spacing = 0): string {
  return JSON.stringify(sortJson(value), null, spacing);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function referencedSchemas(document: OpenApiDocument, value: unknown): Record<string, JsonSchema> {
  const schemas: Record<string, JsonSchema> = {};
  const seen = new Set<unknown>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    const record = item as Record<string, unknown>;
    const reference = record.$ref;
    const prefix = "#/components/schemas/";
    if (typeof reference === "string" && reference.startsWith(prefix)) {
      const name = reference.slice(prefix.length);
      const schema = document.components?.schemas?.[name];
      if (schema && !schemas[name]) {
        schemas[name] = schema;
        visit(schema);
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return Object.fromEntries(
    Object.entries(schemas).toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

export function clientPathFromOperationID(operationID: string): string {
  if (operationID === "session.message.list") return "message.list";
  if (operationID.startsWith("server.experimental.")) {
    return operationID.replace(/^server\./, "");
  }
  const segments = operationID
    .replace(/^v2\./, "")
    .replace(/^experimental\./, "")
    .split(".");
  if (
    segments[0] === "session" &&
    (segments[1] === "permission" || (operationID.startsWith("v2.") && segments[1] === "form"))
  ) {
    segments.shift();
  }
  if (segments[0] === "fs") segments[0] = "file";
  return segments.join(".");
}

function schemaFields(
  schema: JsonSchema | undefined,
  document: OpenApiDocument,
): { fields: Set<string>; required: Set<string> } {
  if (!schema) return { fields: new Set(), required: new Set() };
  if (schema.$ref) {
    const prefix = "#/components/schemas/";
    if (schema.$ref.startsWith(prefix)) {
      return schemaFields(
        document.components?.schemas?.[schema.$ref.slice(prefix.length)],
        document,
      );
    }
  }
  const fields = new Set(Object.keys(schema.properties ?? {}));
  const required = new Set(schema.required ?? []);
  for (const branch of [
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.allOf ?? []),
  ]) {
    const nested = schemaFields(branch, document);
    for (const field of nested.fields) fields.add(field);
    for (const field of nested.required) required.add(field);
  }
  return { fields, required };
}

function requestSchema(operation: OpenApiOperation): JsonSchema | undefined {
  const content = operation.requestBody?.content;
  return content?.["application/json"]?.schema ?? Object.values(content ?? {})[0]?.schema;
}

function isStreaming(operation: OpenApiOperation): boolean {
  return Object.values(operation.responses ?? {}).some((response) =>
    Object.keys(response.content ?? {}).some((contentType) => contentType === "text/event-stream"),
  );
}

function contractEventTypes(document: OpenApiDocument): string[] {
  const eventOperation = Object.values(document.paths ?? {})
    .flatMap((item) => Object.values(item))
    .find((operation) =>
      ["v2.event.subscribe", "event.subscribe"].includes(operation.operationId ?? ""),
    );
  const response = eventOperation?.responses?.["200"];
  const stream = response?.content?.["text/event-stream"]?.schema;
  const data = stream?.properties?.data;
  const values = new Set<string>();
  const seen = new Set<JsonSchema>();
  const visit = (schema: JsonSchema | undefined): void => {
    if (!schema || seen.has(schema)) return;
    seen.add(schema);
    if (schema.$ref) {
      const prefix = "#/components/schemas/";
      if (schema.$ref.startsWith(prefix)) {
        visit(document.components?.schemas?.[schema.$ref.slice(prefix.length)]);
      }
    }
    const types = schema.properties?.type?.enum;
    for (const value of types ?? []) if (typeof value === "string") values.add(value);
    for (const property of Object.values(schema.properties ?? {})) visit(property);
    for (const branch of [
      ...(schema.anyOf ?? []),
      ...(schema.oneOf ?? []),
      ...(schema.allOf ?? []),
    ]) {
      visit(branch);
    }
    visit(schema.items);
  };
  visit(data);
  return [...values].toSorted();
}

export function inventoryFromOpenApi(
  document: OpenApiDocument,
  input: {
    version: string;
    source: string;
    eventTypes?: string[];
    eventPayloads?: Record<string, EventPayload>;
  },
): ContractInventory {
  const operations: ContractOperation[] = [];
  for (const [operationPath, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation?.operationId) continue;
      const parameters = operation.parameters ?? [];
      const body = schemaFields(requestSchema(operation), document);
      const inputFields = new Set(
        parameters.flatMap((parameter) => (parameter.name ? [parameter.name] : [])),
      );
      const required = new Set(
        parameters.flatMap((parameter) =>
          parameter.required && parameter.name ? [parameter.name] : [],
        ),
      );
      for (const field of body.fields) inputFields.add(field);
      for (const field of body.required) required.add(field);
      if (operation.requestBody?.content?.["application/octet-stream"]) {
        // The generated Promise client passes a raw binary body as input.payload.
        inputFields.add("payload");
        if (operation.requestBody.required) required.add("payload");
      }
      if (operationPath.includes("*")) {
        inputFields.add("path");
        required.add("path");
      }
      const statuses = Object.keys(operation.responses ?? {})
        .map(Number)
        .filter(Number.isFinite)
        .toSorted((left, right) => left - right);
      const operationID = operation.operationId;
      const contractShape = {
        parameters,
        requestBody: operation.requestBody ?? null,
        responses: operation.responses ?? null,
        schemas: referencedSchemas(document, {
          parameters,
          requestBody: operation.requestBody ?? null,
          responses: operation.responses ?? null,
        }),
      };
      const normalized = {
        operationID,
        method: method.toUpperCase(),
        path: operationPath,
        ...contractShape,
      };
      const clientPath = clientPathFromOperationID(operationID);
      operations.push({
        operationID,
        clientPath,
        method: method.toUpperCase(),
        path: operationPath,
        group: clientPath.split(".")[0] ?? clientPath,
        summary: operation.summary ?? null,
        description: operation.description ?? null,
        experimental:
          operationPath.includes("/experimental/") || operationID.includes(".experimental."),
        promiseClient: !promiseOmitEndpoints.has(clientPath.replace(/^file\./, "fs.")),
        streaming: isStreaming(operation),
        inputFields: [...inputFields].toSorted(),
        requiredInputFields: [...required].toSorted(),
        successStatuses: statuses.filter((status) => status >= 200 && status < 300),
        errorStatuses: statuses.filter((status) => status < 200 || status >= 300),
        fingerprint: hash(normalized),
        contractShape,
      });
    }
  }
  operations.sort((left, right) => left.operationID.localeCompare(right.operationID));
  const eventTypes = input.eventTypes ?? contractEventTypes(document);
  return {
    version: input.version,
    source: input.source,
    fingerprint: hash({
      operations: operations.map(({ fingerprint, operationID }) => ({ operationID, fingerprint })),
      eventTypes,
      eventPayloads: input.eventPayloads ?? null,
    }),
    operations,
    eventTypes,
    eventPayloads: input.eventPayloads ?? null,
  };
}

export function installedContract(version: string): ContractInventory {
  const document = OpenApi.fromApi(ClientApi) as OpenApiDocument;
  return inventoryFromOpenApi(document, {
    version,
    source: "installed",
    ...eventContractFromDeclarations(resolvedPackages.declarations),
  });
}

export function compareContracts(
  current: ContractInventory,
  candidate: ContractInventory,
): ContractComparison {
  const currentOperations = new Map(
    current.operations.map((operation) => [operation.operationID, operation]),
  );
  const candidateOperations = new Map(
    candidate.operations.map((operation) => [operation.operationID, operation]),
  );
  const added = [...candidateOperations.keys()]
    .filter((operationID) => !currentOperations.has(operationID))
    .toSorted();
  const removed = [...currentOperations.keys()]
    .filter((operationID) => !candidateOperations.has(operationID))
    .toSorted();
  const changed = [...candidateOperations.entries()]
    .filter(
      ([operationID, operation]) =>
        currentOperations.has(operationID) &&
        currentOperations.get(operationID)?.fingerprint !== operation.fingerprint,
    )
    .map(([operationID]) => operationID)
    .toSorted();
  const payloadsAvailable = current.eventPayloads !== null && candidate.eventPayloads !== null;
  const changedEventPayloads = payloadsAvailable
    ? Object.entries(candidate.eventPayloads!)
        .flatMap(([type, payload]) => {
          const previous = current.eventPayloads![type];
          return previous && previous.fingerprint !== payload.fingerprint
            ? [{ type, current: previous, candidate: payload }]
            : [];
        })
        .toSorted((left, right) => left.type.localeCompare(right.type))
    : [];
  return {
    source: candidate.source,
    version: candidate.version,
    fingerprint: candidate.fingerprint,
    added,
    removed,
    changed,
    changedEvents: changedEventPayloads.map(({ type }) => type),
    changedEventPayloads,
    eventPayloadComparison: payloadsAvailable ? "available" : "unavailable",
    addedEvents:
      candidate.eventTypes.length > 0
        ? candidate.eventTypes.filter((type) => !current.eventTypes.includes(type))
        : [],
    removedEvents:
      candidate.eventTypes.length > 0
        ? current.eventTypes.filter((type) => !candidate.eventTypes.includes(type))
        : [],
    addedOperations: added.flatMap((operationID) => {
      const operation = candidateOperations.get(operationID);
      return operation ? [operation] : [];
    }),
    removedOperations: removed.flatMap((operationID) => {
      const operation = currentOperations.get(operationID);
      return operation ? [operation] : [];
    }),
    changedOperations: changed.flatMap((operationID) => {
      const currentOperation = currentOperations.get(operationID);
      const candidateOperation = candidateOperations.get(operationID);
      return currentOperation && candidateOperation
        ? [{ operationID, current: currentOperation, candidate: candidateOperation }]
        : [];
    }),
  };
}

function walkType(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key as keyof Node] as unknown;
    if (Array.isArray(child)) {
      for (const item of child)
        if (item && typeof item === "object" && "type" in item) walkType(item as Node, visit);
    } else if (child && typeof child === "object" && "type" in child) {
      walkType(child as Node, visit);
    }
  }
}

export function eventContractFromDeclarations(declarations: string): {
  eventTypes: string[];
  eventPayloads: Record<string, EventPayload>;
} {
  const parsed = parseSync(declarations, readFileSync(declarations, "utf8"), {
    lang: "dts",
    range: false,
  });
  const aliases = new Map<string, TSTypeAliasDeclaration>();
  if (parsed.errors.length > 0)
    throw new Error(`Could not parse OpenCode declarations at ${declarations}.`);
  walkType(parsed.program, (node) => {
    if (node.type === "TSTypeAliasDeclaration") aliases.set(node.id.name, node);
  });
  const event = aliases.get("V2Event");
  if (!event || event.typeAnnotation.type !== "TSUnionType")
    throw new Error(`Missing V2Event union in ${declarations}.`);
  const eventPayloads: Record<string, EventPayload> = {};
  for (const member of event.typeAnnotation.types) {
    if (member.type !== "TSTypeReference" || member.typeName.type !== "Identifier")
      throw new Error(`Unsupported V2Event member in ${declarations}.`);
    const alias = aliases.get(member.typeName.name);
    if (!alias || alias.typeAnnotation.type !== "TSTypeLiteral")
      throw new Error(`Missing event payload declaration in ${declarations}.`);
    const references: Record<string, unknown> = {};
    const collect = (node: Node): void => {
      walkType(node, (child) => {
        if (child.type !== "TSTypeReference" || child.typeName.type !== "Identifier") return;
        const name = child.typeName.name;
        const reference = aliases.get(name);
        if (!reference || name in references) return;
        references[name] = canonicalType(reference.typeAnnotation);
        collect(reference.typeAnnotation);
      });
    };
    collect(alias.typeAnnotation);
    const shape = { declaration: canonicalType(alias.typeAnnotation), references };
    let found = false;
    for (const node of alias.typeAnnotation.members) {
      if (
        node.type !== "TSPropertySignature" ||
        node.key.type !== "Identifier" ||
        node.key.name !== "type"
      )
        continue;
      const annotation = node.typeAnnotation?.typeAnnotation;
      if (annotation?.type === "TSTemplateLiteralType") {
        const pattern = annotation.quasis
          .map((quasi, index) => {
            const part = annotation.types[index];
            return (
              (quasi.value.cooked ?? "") +
              (part?.type === "TSLiteralType" && part.literal.type === "Literal"
                ? String(part.literal.value)
                : part
                  ? "${string}"
                  : "")
            );
          })
          .join("");
        eventPayloads[pattern] = { fingerprint: hash(shape), shape };
        found = true;
      }
      if (
        annotation?.type === "TSLiteralType" &&
        annotation.literal.type === "Literal" &&
        typeof annotation.literal.value === "string"
      ) {
        eventPayloads[annotation.literal.value] = { fingerprint: hash(shape), shape };
        found = true;
      }
    }
    if (!found)
      throw new Error(`Missing event discriminator in ${declarations}: ${alias.id.name}.`);
  }
  const result = Object.keys(eventPayloads).toSorted();
  if (result.length === 0) {
    throw new Error(`Could not extract OpenCode events from ${declarations}.`);
  }
  return { eventTypes: result, eventPayloads };
}

function canonicalType(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalType);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["start", "end", "raw", "loc", "range", "comments"].includes(key))
      .map(([key, child]) => [key, canonicalType(child)]),
  );
}

async function npmView(packageName: string, field: string): Promise<unknown> {
  const { stdout } = await execFileAsync("npm", ["view", packageName, field, "--json"], {
    maxBuffer: 16 * 1_024 * 1_024,
  });
  return JSON.parse(stdout);
}

function isolatedEnvironment(root: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: root,
    XDG_CONFIG_HOME: path.join(root, ".config"),
    XDG_DATA_HOME: path.join(root, ".local/share"),
    XDG_STATE_HOME: path.join(root, ".local/state"),
    XDG_CACHE_HOME: path.join(root, ".cache"),
    NO_COLOR: "1",
  };
}

export async function resolveAlignedChannel(channel: "beta" | "dev"): Promise<string> {
  const packages = ["cli", "client", "protocol", "schema"].map((name) => `@opencode/${name}`);
  const tags = await Promise.all(
    packages.map(async (packageName) => {
      const value = (await npmView(packageName, "dist-tags")) as Record<string, string>;
      return { packageName, version: value[channel] };
    }),
  );
  const versions = new Set(tags.map((entry) => entry.version));
  if (versions.size !== 1 || tags.some((entry) => !entry.version)) {
    throw new Error(
      `OpenCode ${channel} tags are not aligned: ${tags
        .map((entry) => `${entry.packageName}=${entry.version ?? "missing"}`)
        .join(", ")}`,
    );
  }
  return tags[0]?.version ?? "";
}

async function generateRemoteContract(
  version: string,
  cacheDirectory: string,
): Promise<{
  document: OpenApiDocument;
  eventTypes: string[];
  eventPayloads: Record<string, EventPayload>;
}> {
  const cachePath = path.join(cacheDirectory, `${version}.contract.json`);
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as {
      document?: OpenApiDocument;
      eventTypes?: string[];
      eventPayloads?: Record<string, EventPayload>;
      schemaVersion?: number;
    };
    if (
      cached.schemaVersion === 2 &&
      cached.document &&
      cached.eventTypes?.length &&
      cached.eventPayloads &&
      cached.eventTypes.every((type) => cached.eventPayloads?.[type]?.fingerprint)
    ) {
      return {
        document: cached.document,
        eventTypes: cached.eventTypes,
        eventPayloads: cached.eventPayloads,
      };
    }
  } catch {
    // The exact contract has not been cached yet.
  }
  await mkdir(cacheDirectory, { recursive: true });
  const root = await mkdtemp(path.join(tmpdir(), "palot-opencode-coverage-"));
  try {
    const environment = isolatedEnvironment(root);
    const dependencies = (await npmView(`@opencode/protocol@${version}`, "dependencies")) as Record<
      string,
      string
    >;
    const effectVersion = dependencies.effect;
    if (!effectVersion) throw new Error(`OpenCode protocol ${version} does not declare Effect.`);
    await writeFile(
      path.join(root, "package.json"),
      stableJson(
        {
          private: true,
          type: "module",
          dependencies: {
            "@opencode/client": version,
            "@opencode/protocol": version,
            effect: effectVersion,
          },
        },
        2,
      ),
    );
    await execFileAsync("bun", ["install", "--ignore-scripts", "--silent"], {
      cwd: root,
      env: environment,
      maxBuffer: 16 * 1_024 * 1_024,
    });
    const helper = path.join(root, "contract.mjs");
    await writeFile(
      helper,
      [
        'import { ClientApi } from "@opencode/protocol/client";',
        'import { OpenApi } from "effect/unstable/httpapi";',
        "process.stdout.write(JSON.stringify(OpenApi.fromApi(ClientApi)));",
      ].join("\n"),
    );
    const { stdout } = await execFileAsync("bun", [helper], {
      cwd: root,
      env: environment,
      maxBuffer: 128 * 1_024 * 1_024,
    });
    const document = JSON.parse(stdout) as OpenApiDocument;
    const events = eventContractFromDeclarations(resolveCoveragePackages(helper).declarations);
    await writeFile(cachePath, stableJson({ schemaVersion: 2, document, ...events }));
    return { document, ...events };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function publishedContract(input: {
  channel: "beta" | "dev";
  cacheDirectory: string;
}): Promise<ContractInventory> {
  const version = await resolveAlignedChannel(input.channel);
  const { document, eventTypes, eventPayloads } = await generateRemoteContract(
    version,
    input.cacheDirectory,
  );
  return inventoryFromOpenApi(document, {
    version,
    source: `npm:${input.channel}`,
    eventTypes,
    eventPayloads,
  });
}

export async function contractFromFile(file: string, source: string): Promise<ContractInventory> {
  const document = JSON.parse(await readFile(file, "utf8")) as OpenApiDocument;
  return inventoryFromOpenApi(document, {
    version: document.info?.version ?? "source",
    source,
  });
}
