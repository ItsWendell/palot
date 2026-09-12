// @vitest-environment node

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AutomationDefinition } from "../../shared";
import { AutomationDefinitionRegistry } from "./definitions";

describe("AutomationDefinitionRegistry", () => {
  it("stores the prompt separately from readable metadata", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "palot-automations-"));
    const registry = new AutomationDefinitionRegistry(directory);
    const definition = fixture();

    await registry.write(definition);

    const metadata = await readFile(path.join(directory, definition.id, "automation.json"), "utf8");
    const prompt = await readFile(path.join(directory, definition.id, "prompt.md"), "utf8");
    expect(metadata).not.toContain(definition.action.prompt);
    expect(prompt).toBe(`${definition.action.prompt}\n`);
    await expect(registry.read(definition.id)).resolves.toEqual(definition);
  });

  it("stores standalone automation memory beside the definition without overwriting it", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "palot-automations-"));
    const registry = new AutomationDefinitionRegistry(directory);
    const definition = fixture();
    await registry.write(definition);

    const memoryPath = await registry.ensureMemory(definition.id);
    expect(await readFile(memoryPath, "utf8")).toBe("");
    await writeFile(memoryPath, "Updated: now\nReviewed issue 42.\n", "utf8");
    await registry.write({ ...definition, updatedAt: 200 });

    expect(await readFile(memoryPath, "utf8")).toBe("Updated: now\nReviewed issue 42.\n");
    expect(registry.memoryPath(definition.id)).toBe(
      path.join(directory, definition.id, "memory.md"),
    );
  });

  it("does not create memory for a session-targeted automation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "palot-automations-"));
    const registry = new AutomationDefinitionRegistry(directory);
    const definition: AutomationDefinition = {
      ...fixture(),
      destination: { type: "session", sessionID: "session-1" },
    };
    await registry.write(definition);

    await expect(readFile(registry.memoryPath(definition.id), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps memory but hides a tombstoned active automation from startup", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "palot-automations-"));
    const registry = new AutomationDefinitionRegistry(directory);
    const definition = fixture();
    await registry.write(definition);
    const memoryPath = await registry.ensureMemory(definition.id);
    await writeFile(memoryPath, "Active run memory\n", "utf8");

    await registry.tombstone(definition.id);

    await expect(readFile(memoryPath, "utf8")).resolves.toBe("Active run memory\n");
    await expect(
      readFile(path.join(directory, definition.id, "automation.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(registry.load()).resolves.toEqual({ definitions: [], errors: [] });
  });

  it("reports corrupt definitions without loading them", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "palot-automations-"));
    const registry = new AutomationDefinitionRegistry(directory);
    const definition = fixture();
    await registry.write(definition);
    await writeFile(path.join(directory, definition.id, "automation.json"), "{}", "utf8");

    const result = await registry.load();
    expect(result.definitions).toEqual([]);
    expect(result.errors[0]).toMatchObject({ id: definition.id });
  });

  it("rejects metadata whose ID does not match its folder", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "palot-automations-"));
    const registry = new AutomationDefinitionRegistry(directory);
    const definition = fixture();
    await registry.write(definition);
    const metadataFile = path.join(directory, definition.id, "automation.json");
    const metadata = JSON.parse(await readFile(metadataFile, "utf8")) as Record<string, unknown>;
    await writeFile(metadataFile, JSON.stringify({ ...metadata, id: "automation-2" }), "utf8");

    const result = await registry.load();
    expect(result.definitions).toEqual([]);
    expect(result.errors[0]).toMatchObject({
      id: definition.id,
      message: expect.stringContaining("does not match folder"),
    });
  });
});

function fixture(): AutomationDefinition {
  return {
    version: 1,
    id: "automation-1",
    profileID: "local",
    name: "Morning sweep",
    status: "active",
    action: { prompt: "Review the current changes.", agent: null, model: null, skills: [] },
    destination: {
      type: "standalone",
      projectID: "project-1",
      sourceDirectory: "/project",
      workspace: { type: "new-worktree" },
    },
    trigger: {
      version: 1,
      type: "recurring",
      dtstart: Date.parse("2026-08-22T09:00:00Z"),
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
