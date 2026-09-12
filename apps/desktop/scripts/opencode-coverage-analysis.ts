import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseSync,
  visitorKeys,
  type CallExpression,
  type Expression,
  type Node,
  type ObjectExpression,
  type Program,
} from "oxc-parser";
import type { ContractInventory, ContractOperation } from "./opencode-coverage-contract";

export type EvidenceKind = "production" | "unit" | "e2e";

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  kind: EvidenceKind;
}

export interface OperationEvidence {
  operationID: string;
  clientPath: string;
  productionCalls: number;
  unitTestCalls: number;
  e2eCalls: number;
  mockDefinitions: number;
  productionFiles: string[];
  testFiles: string[];
  requestFieldsObserved: string[];
  requestCoverageComplete: boolean;
  responsePathsObserved: string[];
  locations: SourceLocation[];
}

export interface EventEvidence {
  type: string;
  productionMentions: number;
  unitTestMentions: number;
  e2eMentions: number;
  productionFiles: string[];
  testFiles: string[];
  locations: SourceLocation[];
}

export interface StaticAnalysis {
  operations: OperationEvidence[];
  events: EventEvidence[];
  eventTypes: string[];
  diagnostics: string[];
}

interface ParsedSource {
  file: string;
  relativePath: string;
  kind: EvidenceKind;
  source: string;
  program: Program;
  parents: WeakMap<Node, Node>;
  variables: Map<string, Array<{ start: number; init: Expression }>>;
  lineStarts: number[];
  clientNames: Set<string>;
}

interface MutableOperationEvidence {
  operationID: string;
  clientPath: string;
  productionCalls: number;
  unitTestCalls: number;
  e2eCalls: number;
  mockDefinitions: number;
  productionFiles: Set<string>;
  testFiles: Set<string>;
  requestFieldsObserved: Set<string>;
  requestCoverageComplete: boolean;
  responsePathsObserved: Set<string>;
  locations: SourceLocation[];
}

interface MutableEventEvidence {
  type: string;
  productionMentions: number;
  unitTestMentions: number;
  e2eMentions: number;
  productionFiles: Set<string>;
  testFiles: Set<string>;
  locations: SourceLocation[];
}

function evidenceKind(file: string): EvidenceKind {
  const normalized = file.replaceAll("\\", "/");
  if (normalized.includes("/test/e2e/") || normalized.endsWith("/scripts/e2e.ts")) return "e2e";
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)) return "unit";
  return "production";
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key as keyof Node] as unknown;
    if (Array.isArray(child)) {
      for (const item of child) if (isNode(item)) walk(item, visit);
    } else if (isNode(child)) {
      walk(child, visit);
    }
  }
}

function isNode(value: unknown): value is Node {
  return Boolean(value && typeof value === "object" && "type" in value);
}

function parents(program: Program): WeakMap<Node, Node> {
  const values = new WeakMap<Node, Node>();
  walk(program, (node) => {
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key as keyof Node] as unknown;
      if (Array.isArray(child)) {
        for (const item of child) if (isNode(item)) values.set(item, node);
      } else if (isNode(child)) {
        values.set(child, node);
      }
    }
  });
  return values;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function location(context: ParsedSource, node: Node): SourceLocation {
  let low = 0;
  let high = context.lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if ((context.lineStarts[middle] ?? 0) <= node.start) low = middle;
    else high = middle;
  }
  return {
    file: context.relativePath,
    line: low + 1,
    column: node.start - (context.lineStarts[low] ?? 0) + 1,
    kind: context.kind,
  };
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(target);
        else if (/\.[cm]?tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
          files.push(target);
      }),
    );
  };
  for (const directory of ["src", "scripts", "test"]) await visit(path.join(root, directory));
  return files.toSorted();
}

function collectVariables(
  program: Program,
): Map<string, Array<{ start: number; init: Expression }>> {
  const variables = new Map<string, Array<{ start: number; init: Expression }>>();
  walk(program, (node) => {
    if (
      node.type !== "VariableDeclarator" ||
      node.id.type !== "Identifier" ||
      !node.init ||
      node.init.type === "JSXElement" ||
      node.init.type === "JSXFragment"
    )
      return;
    const values = variables.get(node.id.name) ?? [];
    values.push({ start: node.start, init: node.init });
    variables.set(node.id.name, values);
  });
  for (const values of variables.values()) values.sort((left, right) => left.start - right.start);
  return variables;
}

function collectClientNames(program: Program, source: string): Set<string> {
  const names = new Set<string>();
  if (source.includes('"@opencode/client"')) {
    names.add("client");
    names.add("managedClient");
  }
  walk(program, (node) => {
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init) {
      const declaration = source.slice(node.id.start, node.init.start);
      const factory =
        node.init.type === "CallExpression"
          ? source.slice(node.init.callee.start, node.init.callee.end)
          : "";
      if (
        declaration.includes("OpenCodeClient") ||
        factory === "openCodeClient" ||
        factory === "OpenCode.make"
      ) {
        names.add(node.id.name);
      }
    }
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      for (const parameter of node.params) {
        if (
          parameter.type === "Identifier" &&
          source.slice(parameter.start, parameter.end).includes("OpenCodeClient")
        ) {
          names.add(parameter.name);
        }
      }
    }
  });
  return names;
}

async function parseSources(
  appRoot: string,
  workspaceRoot: string,
): Promise<{
  sources: ParsedSource[];
  diagnostics: string[];
  propertyLiterals: Map<string, string[]>;
}> {
  const files = await sourceFiles(appRoot);
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const diagnostics: string[] = [];
  const propertyLiterals = new Map<string, Set<string>>();
  const sources = files.map((file, index) => {
    const source = contents[index] ?? "";
    for (const match of source.matchAll(
      /\b([A-Za-z_$][\w$]*)\s*:\s*((?:"[^"]+"\s*\|\s*)+"[^"]+")/g,
    )) {
      const name = match[1];
      if (!name) continue;
      const values = propertyLiterals.get(name) ?? new Set<string>();
      for (const literal of match[2]?.matchAll(/"([^"]+)"/g) ?? []) {
        if (literal[1]) values.add(literal[1]);
      }
      propertyLiterals.set(name, values);
    }
    const parsed = parseSync(file, source, { range: true, showSemanticErrors: false });
    for (const error of parsed.errors)
      diagnostics.push(`${path.relative(workspaceRoot, file)}: ${error.message}`);
    return {
      file,
      relativePath: path.relative(workspaceRoot, file).replaceAll("\\", "/"),
      kind: evidenceKind(file),
      source,
      program: parsed.program,
      parents: parents(parsed.program),
      variables: collectVariables(parsed.program),
      lineStarts: lineStarts(source),
      clientNames: collectClientNames(parsed.program, source),
    };
  });
  return {
    sources,
    diagnostics: diagnostics.toSorted(),
    propertyLiterals: new Map(
      [...propertyLiterals].map(([name, values]) => [name, [...values].toSorted()]),
    ),
  };
}

function unwrap(expression: Expression): Expression {
  if (
    expression.type === "ParenthesizedExpression" ||
    expression.type === "TSAsExpression" ||
    expression.type === "TSTypeAssertion" ||
    expression.type === "TSNonNullExpression" ||
    expression.type === "ChainExpression"
  ) {
    return unwrap(expression.expression);
  }
  return expression;
}

function computedSegments(property: Expression, propertyLiterals: Map<string, string[]>): string[] {
  if (property.type === "Literal" && typeof property.value === "string") return [property.value];
  if (property.type === "MemberExpression" && property.property.type === "Identifier") {
    return propertyLiterals.get(property.property.name) ?? [];
  }
  return [];
}

function memberChains(
  expression: Expression,
  propertyLiterals: Map<string, string[]>,
): { root: Expression; paths: string[][] } {
  const value = unwrap(expression);
  if (value.type !== "MemberExpression") return { root: value, paths: [[]] };
  const parent = memberChains(value.object, propertyLiterals);
  const segments = value.computed
    ? computedSegments(value.property, propertyLiterals)
    : value.property.type === "Identifier"
      ? [value.property.name]
      : [];
  return {
    root: parent.root,
    paths: parent.paths.flatMap((item) => segments.map((segment) => [...item, segment])),
  };
}

function calleeName(expression: Expression): string | null {
  const value = unwrap(expression);
  if (value.type === "Identifier") return value.name;
  if (
    value.type === "MemberExpression" &&
    !value.computed &&
    value.property.type === "Identifier"
  ) {
    return value.property.name;
  }
  return null;
}

function clientRoot(expression: Expression, context: ParsedSource): boolean {
  const value = unwrap(expression);
  if (value.type === "Identifier") return context.clientNames.has(value.name);
  if (value.type === "CallExpression") return calleeName(value.callee) === "openCodeClient";
  return false;
}

function resolveVariable(
  identifier: string,
  before: number,
  variables: ParsedSource["variables"],
): Expression | null {
  return (variables.get(identifier) ?? []).findLast((value) => value.start < before)?.init ?? null;
}

function requestFields(
  expression: Expression | undefined,
  context: ParsedSource,
  seen = new Set<Expression>(),
): { fields: Set<string>; complete: boolean } {
  if (!expression || seen.has(expression)) return { fields: new Set(), complete: !expression };
  seen.add(expression);
  const value = unwrap(expression);
  if (value.type === "Identifier") {
    const initialized = resolveVariable(value.name, value.start, context.variables);
    return initialized
      ? requestFields(initialized, context, seen)
      : { fields: new Set(), complete: false };
  }
  if (value.type === "ConditionalExpression") {
    const left = requestFields(value.consequent, context, seen);
    const right = requestFields(value.alternate, context, seen);
    return {
      fields: new Set([...left.fields, ...right.fields]),
      complete: left.complete && right.complete,
    };
  }
  if (value.type !== "ObjectExpression") return { fields: new Set(), complete: false };
  const fields = new Set<string>();
  let complete = true;
  for (const property of value.properties) {
    if (property.type === "SpreadElement") {
      const spread = requestFields(property.argument, context, seen);
      for (const field of spread.fields) fields.add(field);
      complete &&= spread.complete;
      continue;
    }
    if (property.type !== "Property") continue;
    if (property.key.type === "Identifier") fields.add(property.key.name);
    else if (property.key.type === "Literal" && typeof property.key.value === "string") {
      fields.add(property.key.value);
    } else complete = false;
  }
  return { fields, complete };
}

function isWrapper(node: Node): boolean {
  return (
    node.type === "AwaitExpression" ||
    node.type === "ParenthesizedExpression" ||
    node.type === "TSAsExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "TSNonNullExpression" ||
    node.type === "ChainExpression"
  );
}

function expressionRoot(expression: Expression): { root: Expression; path: string[] } {
  const value = unwrap(expression);
  if (value.type !== "MemberExpression") return { root: value, path: [] };
  const parent = expressionRoot(value.object);
  if (!value.computed && value.property.type === "Identifier") {
    parent.path.push(value.property.name);
  } else if (
    value.computed &&
    value.property.type === "Literal" &&
    typeof value.property.value === "string"
  ) {
    parent.path.push(value.property.value);
  }
  return parent;
}

function enclosingScope(node: Node, context: ParsedSource): Node {
  let value: Node = node;
  while (context.parents.has(value)) {
    const parent = context.parents.get(value);
    if (!parent) break;
    if (
      parent.type === "FunctionDeclaration" ||
      parent.type === "FunctionExpression" ||
      parent.type === "ArrowFunctionExpression"
    )
      return parent;
    value = parent;
  }
  return context.program;
}

function responsePaths(call: CallExpression, context: ParsedSource): string[] {
  let value: Node = call;
  while (context.parents.get(value) && isWrapper(context.parents.get(value)!))
    value = context.parents.get(value)!;
  const parent = context.parents.get(value);
  if (
    parent?.type === "MemberExpression" &&
    parent.object === value &&
    !parent.computed &&
    parent.property.type === "Identifier"
  ) {
    return [parent.property.name];
  }
  if (parent?.type !== "VariableDeclarator") return [];
  if (parent.id.type === "ObjectPattern") {
    return parent.id.properties.flatMap((property) => {
      if (property.type !== "Property") return [];
      if (property.key.type === "Identifier") return [property.key.name];
      if (property.key.type === "Literal" && typeof property.key.value === "string")
        return [property.key.value];
      return [];
    });
  }
  if (parent.id.type !== "Identifier") return [];
  const name = parent.id.name;
  const paths = new Set<string>();
  walk(enclosingScope(parent, context), (node) => {
    if (node.type !== "MemberExpression") return;
    const chain = expressionRoot(node);
    if (
      chain.root.type === "Identifier" &&
      chain.root.name === name &&
      chain.root.start > parent.start
    ) {
      if (chain.path.length > 0) paths.add(chain.path.join("."));
    }
  });
  return [...paths].toSorted();
}

function objectLeafPaths(object: ObjectExpression, prefix: string[] = []): string[][] {
  const paths: string[][] = [];
  for (const property of object.properties) {
    if (property.type !== "Property") continue;
    const name =
      property.key.type === "Identifier"
        ? property.key.name
        : property.key.type === "Literal" && typeof property.key.value === "string"
          ? property.key.value
          : null;
    if (!name) continue;
    const next = [...prefix, name];
    if (property.value.type === "ObjectExpression")
      paths.push(...objectLeafPaths(property.value, next));
    else paths.push(next);
  }
  return paths;
}

function isOpenCodeClientMock(object: ObjectExpression, context: ParsedSource): boolean {
  let value: Node = object;
  let end = object.end;
  while (context.parents.has(value)) {
    const parent = context.parents.get(value);
    if (!parent || (parent.type !== "TSAsExpression" && parent.type !== "TSTypeAssertion")) break;
    value = parent;
    end = parent.end;
  }
  return context.source.slice(object.end, end).includes("OpenCodeClient");
}

function normalizedCustomPath(node: Node): string | null {
  if (node.type === "Literal" && typeof node.value === "string" && node.value.startsWith("/api/")) {
    return node.value.split("?")[0] ?? node.value;
  }
  if (node.type !== "TemplateLiteral") return null;
  const value = node.quasis.map((quasi) => quasi.value.raw).join("{}");
  return value.startsWith("/api/") ? (value.split("?")[0] ?? value) : null;
}

function contractCustomPath(value: string): string {
  return value.replaceAll(/\{[^}]+\}/g, "{}");
}

function operationRecord(operation: ContractOperation): MutableOperationEvidence {
  return {
    operationID: operation.operationID,
    clientPath: operation.clientPath,
    productionCalls: 0,
    unitTestCalls: 0,
    e2eCalls: 0,
    mockDefinitions: 0,
    productionFiles: new Set(),
    testFiles: new Set(),
    requestFieldsObserved: new Set(),
    requestCoverageComplete: true,
    responsePathsObserved: new Set(),
    locations: [],
  };
}

export async function analyzeOpenCodeUsage(input: {
  appRoot: string;
  workspaceRoot: string;
  contract: ContractInventory;
}): Promise<StaticAnalysis> {
  const { sources, diagnostics, propertyLiterals } = await parseSources(
    input.appRoot,
    input.workspaceRoot,
  );
  const operations = new Map(
    input.contract.operations.map((operation) => [
      operation.clientPath,
      operationRecord(operation),
    ]),
  );
  const contracts = new Map(
    input.contract.operations.map((operation) => [operation.clientPath, operation]),
  );
  const customOperations = new Map(
    input.contract.operations
      .filter((operation) => !operation.promiseClient)
      .map((operation) => [contractCustomPath(operation.path), operation]),
  );
  const eventEvidence = new Map<string, MutableEventEvidence>(
    input.contract.eventTypes.map((type) => [
      type,
      {
        type,
        productionMentions: 0,
        unitTestMentions: 0,
        e2eMentions: 0,
        productionFiles: new Set(),
        testFiles: new Set(),
        locations: [],
      },
    ]),
  );

  for (const context of sources) {
    const mocks = new Set<string>();
    const recordMock = (object: ObjectExpression): void => {
      for (const leaf of objectLeafPaths(object)) {
        const clientPath = leaf.join(".");
        const evidence = operations.get(clientPath);
        const key = `${object.start}:${clientPath}`;
        if (!evidence || mocks.has(key)) continue;
        mocks.add(key);
        evidence.mockDefinitions += 1;
        evidence.testFiles.add(context.relativePath);
      }
    };
    walk(context.program, (node) => {
      const customPath = normalizedCustomPath(node);
      const customOperation = customPath ? customOperations.get(customPath) : null;
      if (customOperation) {
        const evidence = operations.get(customOperation.clientPath);
        if (evidence) {
          if (context.kind === "production") {
            evidence.productionCalls += 1;
            evidence.productionFiles.add(context.relativePath);
          } else {
            if (context.kind === "unit") evidence.unitTestCalls += 1;
            else evidence.e2eCalls += 1;
            evidence.testFiles.add(context.relativePath);
          }
          evidence.locations.push(location(context, node));
        }
      }
      if (node.type === "CallExpression") {
        const chains = memberChains(node.callee, propertyLiterals);
        if (clientRoot(chains.root, context)) {
          for (const chain of chains.paths) {
            const clientPath = chain.join(".");
            const evidence = operations.get(clientPath);
            const contract = contracts.get(clientPath);
            if (!evidence || !contract) continue;
            if (context.kind === "production") {
              evidence.productionCalls += 1;
              evidence.productionFiles.add(context.relativePath);
            } else {
              if (context.kind === "unit") evidence.unitTestCalls += 1;
              else evidence.e2eCalls += 1;
              evidence.testFiles.add(context.relativePath);
            }
            evidence.locations.push(location(context, node));
            const request = requestFields(
              contract.inputFields.length === 0
                ? undefined
                : node.arguments[0]?.type === "SpreadElement"
                  ? undefined
                  : node.arguments[0],
              context,
            );
            for (const field of request.fields) evidence.requestFieldsObserved.add(field);
            evidence.requestCoverageComplete &&= request.complete;
            for (const responsePath of responsePaths(node, context)) {
              evidence.responsePathsObserved.add(responsePath);
            }
          }
        }
        const name = calleeName(node.callee);
        const object = node.arguments[0];
        if (
          context.kind !== "production" &&
          name &&
          (name === "client" || name.endsWith("ClientForTest")) &&
          object?.type === "ObjectExpression"
        ) {
          recordMock(object);
        }
      }
      if (
        context.kind !== "production" &&
        node.type === "ObjectExpression" &&
        isOpenCodeClientMock(node, context)
      ) {
        recordMock(node);
      }
      if (node.type === "Literal" && typeof node.value === "string") {
        const evidence = eventEvidence.get(node.value);
        if (!evidence) return;
        if (context.kind === "production") {
          evidence.productionMentions += 1;
          evidence.productionFiles.add(context.relativePath);
        } else {
          if (context.kind === "unit") evidence.unitTestMentions += 1;
          else evidence.e2eMentions += 1;
          evidence.testFiles.add(context.relativePath);
        }
        evidence.locations.push(location(context, node));
      }
    });
  }

  return {
    operations: [...operations.values()]
      .map((evidence) => ({
        ...evidence,
        productionFiles: [...evidence.productionFiles].toSorted(),
        testFiles: [...evidence.testFiles].toSorted(),
        requestFieldsObserved: [...evidence.requestFieldsObserved].toSorted(),
        responsePathsObserved: [...evidence.responsePathsObserved].toSorted(),
        locations: evidence.locations.toSorted(
          (left, right) =>
            left.file.localeCompare(right.file) ||
            left.line - right.line ||
            left.column - right.column,
        ),
      }))
      .toSorted((left, right) => left.operationID.localeCompare(right.operationID)),
    events: [...eventEvidence.values()]
      .map((evidence) => ({
        ...evidence,
        productionFiles: [...evidence.productionFiles].toSorted(),
        testFiles: [...evidence.testFiles].toSorted(),
        locations: evidence.locations.toSorted(
          (left, right) =>
            left.file.localeCompare(right.file) ||
            left.line - right.line ||
            left.column - right.column,
        ),
      }))
      .toSorted((left, right) => left.type.localeCompare(right.type)),
    eventTypes: input.contract.eventTypes,
    diagnostics,
  };
}

export async function readPackageVersion(packageFile: string, dependency: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(packageFile, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const version =
    packageJson.dependencies?.[dependency] ?? packageJson.devDependencies?.[dependency];
  if (!version) throw new Error(`${dependency} is not declared in ${packageFile}.`);
  return version;
}
