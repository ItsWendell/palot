import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import * as v from "valibot";
import type { AutomationDefinition, AutomationDraft } from "../../shared";
import { validateAutomationTrigger } from "./recurrence";

const identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
const DELETED_MARKER = ".deleted";
const timestamp = v.pipe(v.number(), v.finite(), v.integer());
const timezone = v.pipe(v.string(), v.minLength(1), v.maxLength(128));
const model = v.strictObject({
  id: identifier,
  providerID: identifier,
  variant: v.optional(identifier),
});
const workspace = v.variant("type", [
  v.strictObject({ type: v.literal("current") }),
  v.strictObject({ type: v.literal("new-worktree") }),
  v.strictObject({ type: v.literal("existing-worktree"), directory: identifier }),
]);
const destination = v.variant("type", [
  v.strictObject({
    type: v.literal("standalone"),
    projectID: identifier,
    sourceDirectory: identifier,
    workspace,
  }),
  v.strictObject({ type: v.literal("session"), sessionID: identifier }),
]);
export const automationTriggerSchema = v.variant("type", [
  v.strictObject({
    version: v.literal(1),
    type: v.literal("once"),
    at: timestamp,
    timezone,
  }),
  v.strictObject({
    version: v.literal(1),
    type: v.literal("recurring"),
    dtstart: timestamp,
    timezone,
    rrule: v.pipe(v.string(), v.minLength(1), v.maxLength(4_096)),
  }),
]);
const missedRuns = v.variant("type", [
  v.strictObject({
    type: v.literal("catch-up-once"),
    maxAgeMs: v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0)),
  }),
  v.strictObject({ type: v.literal("skip") }),
]);
const persistedDefinition = v.strictObject({
  version: v.literal(1),
  id: identifier,
  profileID: identifier,
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  status: v.picklist(["active", "paused"]),
  action: v.strictObject({
    agent: v.nullable(identifier),
    model: v.nullable(model),
    skills: v.pipe(v.array(identifier), v.maxLength(100)),
  }),
  destination,
  trigger: automationTriggerSchema,
  missedRuns,
  notifications: v.picklist(["all-runs", "background-only", "failures-only"]),
  createdFromSessionID: v.nullable(identifier),
  createdAt: timestamp,
  updatedAt: timestamp,
});

type PersistedDefinition = v.InferOutput<typeof persistedDefinition>;

export const automationDraftSchema = v.strictObject({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  status: v.picklist(["active", "paused"]),
  action: v.strictObject({
    prompt: v.pipe(v.string(), v.minLength(1), v.maxLength(200_000)),
    agent: v.nullable(identifier),
    model: v.nullable(model),
    skills: v.pipe(v.array(identifier), v.maxLength(100)),
  }),
  destination,
  trigger: automationTriggerSchema,
  missedRuns,
  notifications: v.picklist(["all-runs", "background-only", "failures-only"]),
  createdFromSessionID: v.nullable(identifier),
});

export function validateAutomationDraft(draft: AutomationDraft): AutomationDraft {
  const value = v.parse(automationDraftSchema, draft);
  validateAutomationTrigger(value.trigger);
  return value;
}

function persistedValue(definition: AutomationDefinition): PersistedDefinition {
  const { prompt: _prompt, ...action } = definition.action;
  return v.parse(persistedDefinition, { ...definition, action });
}

export class AutomationDefinitionRegistry {
  constructor(private readonly directory: string) {}

  memoryPath(id: string): string {
    return path.join(this.directory, id, "memory.md");
  }

  async ensureMemory(id: string): Promise<string> {
    const folder = path.join(this.directory, id);
    await access(folder);
    await chmod(folder, 0o700);
    const file = path.join(await realpath(folder), "memory.md");
    await createFileIfMissing(file);
    await chmod(file, 0o600);
    return file;
  }

  async load(): Promise<{
    definitions: AutomationDefinition[];
    errors: Array<{ id: string; message: string }>;
  }> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.directory, { withFileTypes: true });
    const definitions: AutomationDefinition[] = [];
    const errors: Array<{ id: string; message: string }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (await fileExists(path.join(this.directory, entry.name, DELETED_MARKER))) continue;
      try {
        definitions.push(await this.read(entry.name));
      } catch (error) {
        errors.push({
          id: entry.name,
          message: error instanceof Error ? error.message : "Invalid automation definition",
        });
      }
    }
    return { definitions, errors };
  }

  async read(id: string): Promise<AutomationDefinition> {
    const folder = path.join(this.directory, id);
    const [metadata, prompt] = await Promise.all([
      readFile(path.join(folder, "automation.json"), "utf8"),
      readFile(path.join(folder, "prompt.md"), "utf8"),
    ]);
    const value = v.parse(persistedDefinition, JSON.parse(metadata));
    if (value.id !== id) {
      throw new Error(`Automation definition ID ${value.id} does not match folder ${id}`);
    }
    const definition: AutomationDefinition = {
      ...value,
      action: { ...value.action, prompt: prompt.trim() },
    };
    validateAutomationDraft(draftValue(definition));
    return definition;
  }

  async write(definition: AutomationDefinition): Promise<void> {
    validateAutomationDraft(draftValue(definition));
    const folder = path.join(this.directory, definition.id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await Promise.all([
      atomicWrite(
        path.join(folder, "automation.json"),
        `${JSON.stringify(persistedValue(definition), null, 2)}\n`,
      ),
      atomicWrite(path.join(folder, "prompt.md"), `${definition.action.prompt.trim()}\n`),
    ]);
    if (definition.destination.type === "standalone") await this.ensureMemory(definition.id);
  }

  async remove(id: string): Promise<void> {
    await rm(path.join(this.directory, id), { recursive: true, force: true });
  }

  async tombstone(id: string): Promise<void> {
    const folder = path.join(this.directory, id);
    await atomicWrite(path.join(folder, DELETED_MARKER), "deleted\n");
    await Promise.all([
      rm(path.join(folder, "automation.json"), { force: true }),
      rm(path.join(folder, "prompt.md"), { force: true }),
    ]);
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function createFileIfMissing(file: string): Promise<void> {
  try {
    await writeFile(file, "", { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!isFileSystemError(error, "EEXIST")) throw error;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return false;
    throw error;
  }
}

function draftValue(definition: AutomationDefinition): AutomationDraft {
  return {
    name: definition.name,
    status: definition.status,
    action: definition.action,
    destination: definition.destination,
    trigger: definition.trigger,
    missedRuns: definition.missedRuns,
    notifications: definition.notifications,
    createdFromSessionID: definition.createdFromSessionID,
  };
}
