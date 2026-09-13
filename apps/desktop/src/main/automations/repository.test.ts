// @vitest-environment node

import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AutomationDefinition } from "../../shared";
import { AutomationRepository } from "./repository";

describe("AutomationRepository", () => {
  let sqlite: DatabaseSync;
  let repository: AutomationRepository;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    const database = drizzle({ client: sqlite });
    migrate(database, { migrationsFolder: path.resolve("drizzle") });
    repository = new AutomationRepository(database);
  });

  afterEach(() => sqlite.close());

  it("claims one unique scheduled occurrence and clears overlap on finish", () => {
    const definition = fixture();
    repository.synchronizeDefinition(definition, 1, 1_000);

    const first = repository.createRun({
      id: "run-1",
      definition,
      definitionVersion: 1,
      trigger: "scheduled",
      scheduledFor: 1_000,
      occurrenceKey: "automation-1:scheduled:1000",
      nextRunAt: 2_000,
    });
    const duplicate = repository.createRun({
      id: "run-2",
      definition,
      definitionVersion: 1,
      trigger: "scheduled",
      scheduledFor: 1_000,
      occurrenceKey: "automation-1:scheduled:1000",
      nextRunAt: 2_000,
    });

    expect(first?.state).toBe("pending");
    expect(duplicate).toBeNull();
    expect(
      repository.createRun({
        id: "run-3",
        definition,
        definitionVersion: 1,
        trigger: "manual",
        scheduledFor: 1_001,
        occurrenceKey: "automation-1:manual:run-3",
      }),
    ).toBeNull();
    expect(repository.automation(definition.id)?.activeRunID).toBe("run-1");

    repository.finishRun("run-1", definition.id, {
      state: "succeeded",
      completedAt: 1_100,
      summary: "Ready",
      error: null,
    });
    expect(repository.automation(definition.id)?.activeRunID).toBeNull();
    expect(repository.run("run-1")).toMatchObject({ state: "succeeded", summary: "Ready" });
  });

  it("keeps run history when a definition is deleted", () => {
    const definition = fixture();
    repository.synchronizeDefinition(definition, 1, 1_000);
    repository.createRun({
      id: "run-1",
      definition,
      definitionVersion: 1,
      trigger: "manual",
      scheduledFor: 1_000,
      occurrenceKey: "automation-1:manual:run-1",
    });

    repository.deleteDefinition(definition.id, 2_000);
    expect(repository.automation(definition.id)).toBeNull();
    expect(repository.run("run-1")?.automationID).toBe(definition.id);
  });

  it("records OpenCode execution timing separately from Palot run timing", () => {
    const definition = fixture();
    repository.synchronizeDefinition(definition, 1, 1_000);
    repository.createRun({
      id: "run-timing",
      definition,
      definitionVersion: 1,
      trigger: "manual",
      scheduledFor: 1_000,
      occurrenceKey: "automation-1:manual:run-timing",
    });
    repository.patchRun("run-timing", { startedAt: 5, completedAt: 50 });

    repository.recordExecutionEvent("run-timing", "started", 20);
    repository.recordExecutionEvent("run-timing", "started", 10);
    repository.recordExecutionEvent("run-timing", "completed", 30);
    repository.recordExecutionEvent("run-timing", "completed", 40);

    expect(repository.run("run-timing")).toMatchObject({
      startedAt: 5,
      completedAt: 50,
      executionStartedAt: 10,
      executionCompletedAt: 40,
    });
  });

  it("finds the previous run without treating the active run as history", () => {
    const definition = fixture();
    repository.synchronizeDefinition(definition, 1, 1_000);
    repository.createRun({
      id: "run-1",
      definition,
      definitionVersion: 1,
      trigger: "scheduled",
      scheduledFor: 1_000,
      occurrenceKey: "automation-1:scheduled:1000",
    });
    repository.finishRun("run-1", definition.id, {
      state: "succeeded",
      completedAt: 1_100,
      summary: "Ready",
      error: null,
    });
    repository.createRun({
      id: "run-2",
      definition,
      definitionVersion: 1,
      trigger: "scheduled",
      scheduledFor: 2_000,
      occurrenceKey: "automation-1:scheduled:2000",
    });

    expect(repository.previousRun(definition.id, "run-2")).toMatchObject({
      id: "run-1",
      completedAt: 1_100,
    });
  });

  it("fails closed when canonical definition files disappear or corrupt", () => {
    const valid = fixture();
    const corrupt = { ...fixture(), id: "automation-2", name: "Corrupt" };
    const missing = { ...fixture(), id: "automation-3", name: "Missing" };
    repository.synchronizeDefinition(valid, 1, 1_000);
    repository.synchronizeDefinition(corrupt, 1, 1_000);
    repository.synchronizeDefinition(missing, 1, 1_000);

    repository.reconcileDefinitionFiles([valid.id], [corrupt.id], 2_000);

    expect(repository.automation(valid.id)?.status).toBe("active");
    expect(repository.automation(corrupt.id)?.status).toBe("paused");
    expect(repository.automation(missing.id)).toBeNull();
  });

  it("does not resurrect a deleted automation when a corrupt folder is found", () => {
    const definition = fixture();
    repository.synchronizeDefinition(definition, 1, 1_000);
    repository.deleteDefinition(definition.id, 1_500);

    repository.reconcileDefinitionFiles([], [definition.id], 2_000);

    expect(repository.automation(definition.id)).toBeNull();
  });
});

function fixture(): AutomationDefinition {
  return {
    version: 1,
    id: "automation-1",
    profileID: "local",
    name: "Morning sweep",
    status: "active",
    action: { prompt: "Review current changes.", agent: null, model: null, skills: [] },
    destination: {
      type: "standalone",
      projectID: "project-1",
      sourceDirectory: "/project",
      workspace: { type: "current" },
    },
    trigger: {
      version: 1,
      type: "recurring",
      dtstart: 1_000,
      timezone: "UTC",
      rrule: "FREQ=DAILY;INTERVAL=1",
    },
    missedRuns: { type: "catch-up-once", maxAgeMs: 86_400_000 },
    notifications: "background-only",
    createdFromSessionID: null,
    createdAt: 100,
    updatedAt: 100,
  };
}
