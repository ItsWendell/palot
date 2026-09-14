// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { describe, expect, it, vi } from "vitest";
import type { AutomationDefinition } from "../../shared";
import { AutomationRepository } from "./repository";
import {
  AutomationRunner,
  automationSessionInstructions,
  isAutomationMemoryPermission,
  persistedMessageOutcome,
} from "./runner";

describe("automation worktree location", () => {
  it.each(["create", "existing", "reconcile"] as const)(
    "uses server-selected directories and location-scoped Git %s",
    async (mode) => {
      const sqlite = new DatabaseSync(":memory:");
      const database = drizzle({ client: sqlite });
      migrate(database, { migrationsFolder: path.resolve("drizzle") });
      const repository = new AutomationRepository(database);
      const definition = fixture("/project");
      if (definition.destination.type !== "standalone") throw new Error("Invalid fixture");
      definition.destination.workspace = { type: "new-worktree" };
      repository.synchronizeDefinition(definition, 1, 1_000);
      repository.createRun({
        id: "run-worktree",
        definition,
        definitionVersion: 1,
        trigger: "manual",
        scheduledFor: 1_000,
        occurrenceKey: "automation-1:manual:run-worktree",
      });
      const name = "palot-auto-automati-1000";
      const directory = `/server-configured/${name}`;
      const list = vi.fn().mockResolvedValue([{ directory, strategy: "git" }]);
      if (mode !== "existing") list.mockResolvedValueOnce([]);
      const create = vi.fn().mockResolvedValue({ directory });
      if (mode === "reconcile") create.mockRejectedValueOnce(new Error("response lost"));
      const client = {
        worktree: { list, create },
        agent: { list: vi.fn().mockRejectedValue(new Error("Stop after location resolution")) },
        model: { list: vi.fn().mockResolvedValue({ data: [] }) },
        skill: { list: vi.fn().mockResolvedValue({ data: [] }) },
      } as unknown as OpenCodeClient;
      const runner = new AutomationRunner({
        client: async () => client,
        repository,
        memory: memoryStore(),
        capabilities: () => ({ localPathActions: false, worktreeCreate: true }),
        onChanged: vi.fn(),
        onFinished: vi.fn(),
        onAttention: vi.fn(),
      });
      await runner.execute("run-worktree");
      expect(repository.run("run-worktree")?.worktreeDirectory).toBe(directory);
      expect(list).toHaveBeenCalledWith({ location: { directory: "/project" } }, expect.anything());
      if (mode === "existing") expect(create).not.toHaveBeenCalled();
      else
        expect(create).toHaveBeenCalledWith(
          { location: { directory: "/project" }, strategy: "git", name },
          expect.anything(),
        );
      if (mode === "reconcile") expect(list).toHaveBeenCalledTimes(2);
      sqlite.close();
    },
  );
});

describe("standalone automation memory", () => {
  it("builds automation session instructions with a memory path", () => {
    const definition = fixture("/project");
    const instructions = automationSessionInstructions({
      definition,
      run: {
        id: "run-2",
        automationID: definition.id,
        profileID: definition.profileID,
        definitionVersion: 1,
        trigger: "scheduled",
        scheduledFor: Date.parse("2026-08-25T10:00:00Z"),
        state: "pending",
        rootSessionID: null,
        inboxID: null,
        worktreeDirectory: null,
        sessionCursors: {},
        attention: null,
        summary: null,
        error: null,
        startedAt: null,
        completedAt: null,
        executionStartedAt: null,
        executionCompletedAt: null,
        readAt: null,
        archivedAt: null,
        createdAt: 2,
        updatedAt: 2,
      },
      memoryPath: "/palot/automations/automation-1/memory.md",
      lastRunAt: Date.parse("2026-08-24T10:00:00Z"),
    });

    expect(instructions).toContain("Automation memory: /palot/automations/automation-1/memory.md");
    expect(instructions).toContain("Last run: 2026-08-24T10:00:00.000Z");
    expect(instructions).toContain("Read it first");
    expect(instructions).toContain("Before returning, update it");
    expect(instructions).toContain("Child or subagent sessions");
    expect(instructions).toContain("according to the project's instructions");
  });

  it("recognizes only the automation's external-directory boundary", () => {
    expect(
      isAutomationMemoryPermission(
        ["/palot/automations/automation-1/*"],
        "/palot/automations/automation-1",
      ),
    ).toBe(true);
    expect(
      isAutomationMemoryPermission(["/palot/automations/*"], "/palot/automations/automation-1"),
    ).toBe(false);
    expect(
      isAutomationMemoryPermission(
        ["/palot/automations/automation-2/*"],
        "/palot/automations/automation-1",
      ),
    ).toBe(false);
  });
});

describe("persistedMessageOutcome", () => {
  it("associates a completed assistant response with the run metadata", () => {
    expect(
      persistedMessageOutcome(
        [runInput("run-1", 100), assistant({ created: 110, completed: 120, finish: "stop" })],
        "run-1",
        100,
      ),
    ).toBe("succeeded");
  });

  it("treats persisted assistant errors as failed", () => {
    expect(
      persistedMessageOutcome(
        [
          runInput("run-1", 100),
          assistant({
            created: 110,
            completed: 120,
            finish: "error",
            error: { type: "ProviderError", message: "Provider failed" },
          }),
        ],
        "run-1",
        100,
      ),
    ).toBe("failed");
  });

  it("does not reuse an older execution result for a continuation run", () => {
    expect(
      persistedMessageOutcome(
        [assistant({ created: 50, completed: 60, finish: "stop" }), runInput("run-1", 100)],
        "run-1",
        100,
      ),
    ).toBe("unknown");
  });

  it("does not attribute a later human turn to the scheduled run", () => {
    expect(
      persistedMessageOutcome(
        [
          runInput("run-1", 100),
          assistant({ created: 110 }),
          runInput("human-turn", 120),
          assistant({ created: 130, completed: 140, finish: "stop" }),
        ],
        "run-1",
        100,
      ),
    ).toBe("interrupted");
  });
});

describe("AutomationRunner admission", () => {
  it.each([true, false])(
    "marks uncertain admission unknown without retrying or exposing desktop memory remotely (local=%s)",
    async (localPathActions) => {
      const directory = await mkdtemp(path.join(tmpdir(), "palot-runner-"));
      const sqlite = new DatabaseSync(":memory:");
      const database = drizzle({ client: sqlite });
      migrate(database, { migrationsFolder: path.resolve("drizzle") });
      const repository = new AutomationRepository(database);
      const definition = fixture(directory);
      repository.synchronizeDefinition(definition, 1, 1_000);
      const run = repository.createRun({
        id: "run-unknown",
        definition,
        definitionVersion: 1,
        trigger: "manual",
        scheduledFor: 1_000,
        occurrenceKey: "automation-1:manual:run-unknown",
      });
      expect(run).not.toBeNull();

      const prompt = vi.fn().mockRejectedValue(new Error("request timed out"));
      const emptyMessages = () =>
        Promise.resolve({ data: [], cursor: { previous: null, next: null } });
      const client = {
        agent: { list: vi.fn().mockResolvedValue({ data: [] }) },
        model: { list: vi.fn().mockResolvedValue({ data: [] }) },
        skill: { list: vi.fn().mockResolvedValue({ data: [] }) },
        message: { list: vi.fn(emptyMessages) },
        session: {
          create: vi.fn().mockResolvedValue({ id: "session-1" }),
          get: vi.fn().mockRejectedValue(new Error("not found")),
          list: vi.fn().mockResolvedValue({ data: [], cursor: { previous: null, next: null } }),
          prompt,
          instructions: { entry: { put: vi.fn().mockResolvedValue(undefined) } },
          inbox: { list: vi.fn().mockResolvedValue([]) },
          log: async function* () {},
        },
      } as unknown as OpenCodeClient;
      const memory = memoryStore();
      const runner = new AutomationRunner({
        client: async () => client,
        repository,
        memory,
        capabilities: () => ({ localPathActions, worktreeCreate: true }),
        onChanged: vi.fn(),
        onFinished: vi.fn(),
        onAttention: vi.fn(),
      });

      await runner.execute("run-unknown");

      expect(prompt).toHaveBeenCalledTimes(1);
      expect(client.session.instructions.entry.put).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: "session-1",
          key: "palot.automation",
          value: expect.stringContaining(
            localPathActions
              ? "Automation memory: /automations/automation-1/memory.md"
              : "Persistent cross-run file memory is unavailable on this server.",
          ),
        }),
        expect.anything(),
      );
      if (localPathActions) expect(memory.ensure).toHaveBeenCalledWith(definition.id);
      else {
        expect(memory.ensure).not.toHaveBeenCalled();
        const instruction = vi.mocked(client.session.instructions.entry.put).mock.calls[0]![0]
          .value;
        expect(instruction).not.toContain("/automations/");
        expect(instruction).not.toContain("Read it first");
      }
      expect(prompt).toHaveBeenCalledWith(
        expect.objectContaining({ text: definition.action.prompt }),
        expect.anything(),
      );
      expect(repository.run("run-unknown")).toMatchObject({
        state: "unknown",
        error: { code: "admission_unknown" },
      });
      expect(repository.automation(definition.id)?.activeRunID).toBeNull();
      sqlite.close();
    },
  );

  it.each([true, false])(
    "leaves session-targeted runs on native transcript continuity (local=%s)",
    async (localPathActions) => {
      const sqlite = new DatabaseSync(":memory:");
      const database = drizzle({ client: sqlite });
      migrate(database, { migrationsFolder: path.resolve("drizzle") });
      const repository = new AutomationRepository(database);
      const standalone = fixture("/project");
      const definition: AutomationDefinition = {
        ...standalone,
        destination: { type: "session", sessionID: "session-1" },
      };
      repository.synchronizeDefinition(definition, 1, 1_000);
      repository.createRun({
        id: "run-session",
        definition,
        definitionVersion: 1,
        trigger: "manual",
        scheduledFor: 1_000,
        occurrenceKey: "automation-1:manual:run-session",
      });
      const prompt = vi.fn().mockRejectedValue(new Error("request timed out"));
      const putInstruction = vi.fn().mockResolvedValue(undefined);
      const client = {
        permission: { list: vi.fn().mockResolvedValue([]) },
        form: { list: vi.fn().mockResolvedValue([]) },
        message: {
          list: vi.fn().mockResolvedValue({ data: [], cursor: { previous: null, next: null } }),
        },
        session: {
          get: vi.fn().mockResolvedValue({ id: "session-1", time: { created: 1, updated: 1 } }),
          prompt,
          instructions: { entry: { put: putInstruction } },
          inbox: { list: vi.fn().mockResolvedValue([]) },
          log: async function* () {},
        },
      } as unknown as OpenCodeClient;
      const runner = new AutomationRunner({
        client: async () => client,
        repository,
        memory: memoryStore(),
        capabilities: () => ({ localPathActions, worktreeCreate: true }),
        onChanged: vi.fn(),
        onFinished: vi.fn(),
        onAttention: vi.fn(),
      });

      await runner.execute("run-session");

      expect(putInstruction).not.toHaveBeenCalled();
      expect(prompt).toHaveBeenCalledWith(
        expect.objectContaining({ text: definition.action.prompt, delivery: "queue" }),
        expect.anything(),
      );
      sqlite.close();
    },
  );

  it.each([true, false])(
    "auto-approves the desktop automation memory directory only on its own filesystem (local=%s)",
    async (localPathActions) => {
      const directory = await mkdtemp(path.join(tmpdir(), "palot-runner-"));
      const sqlite = new DatabaseSync(":memory:");
      const database = drizzle({ client: sqlite });
      migrate(database, { migrationsFolder: path.resolve("drizzle") });
      const repository = new AutomationRepository(database);
      const definition = fixture(directory);
      repository.synchronizeDefinition(definition, 1, 1_000);
      repository.createRun({
        id: "run-memory-permission",
        definition,
        definitionVersion: 1,
        trigger: "manual",
        scheduledFor: 1_000,
        occurrenceKey: "automation-1:manual:run-memory-permission",
      });
      const reply = vi.fn().mockResolvedValue(undefined);
      const prompt = vi.fn().mockResolvedValue({ id: "inbox-1", delivery: "steer" });
      const client = {
        agent: { list: vi.fn().mockResolvedValue({ data: [] }) },
        model: { list: vi.fn().mockResolvedValue({ data: [] }) },
        skill: { list: vi.fn().mockResolvedValue({ data: [] }) },
        permission: { list: vi.fn().mockResolvedValue([]), reply },
        form: { list: vi.fn().mockResolvedValue([]) },
        message: {
          list: vi.fn().mockResolvedValue({ data: [], cursor: { previous: null, next: null } }),
        },
        session: {
          create: vi.fn().mockResolvedValue({ id: "session-1" }),
          get: vi.fn().mockRejectedValue(new Error("not found")),
          list: vi.fn().mockResolvedValue({ data: [], cursor: { previous: null, next: null } }),
          prompt,
          wait: vi.fn(
            (_input, options: { signal: AbortSignal }) =>
              new Promise<void>((_resolve, reject) => {
                options.signal.addEventListener("abort", () => reject(options.signal.reason), {
                  once: true,
                });
              }),
          ),
          instructions: { entry: { put: vi.fn().mockResolvedValue(undefined) } },
          inbox: { list: vi.fn().mockResolvedValue([]) },
          log: async function* () {},
        },
      } as unknown as OpenCodeClient;
      const runner = new AutomationRunner({
        client: async () => client,
        repository,
        memory: memoryStore(),
        capabilities: () => ({ localPathActions, worktreeCreate: true }),
        onChanged: vi.fn(),
        onFinished: vi.fn(),
        onAttention: vi.fn(),
      });

      const execution = runner.execute("run-memory-permission");
      await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
      runner.onEvent({
        type: "permission.asked",
        data: {
          id: "permission-1",
          sessionID: "session-1",
          action: "external_directory",
          resources: ["/automations/automation-1/*"],
        },
      } as Parameters<AutomationRunner["onEvent"]>[0]);

      if (localPathActions)
        await vi.waitFor(() =>
          expect(reply).toHaveBeenCalledWith(
            {
              sessionID: "session-1",
              requestID: "permission-1",
              reply: "once",
            },
            expect.anything(),
          ),
        );
      else {
        expect(reply).not.toHaveBeenCalled();
        expect(repository.run("run-memory-permission")?.attention).toMatchObject({
          type: "permission",
          requestID: "permission-1",
        });
      }
      await runner.shutdown();
      await execution;
      sqlite.close();
    },
  );

  it("treats beta question forms as question attention", () => {
    const sqlite = new DatabaseSync(":memory:");
    const database = drizzle({ client: sqlite });
    migrate(database, { migrationsFolder: path.resolve("drizzle") });
    const repository = new AutomationRepository(database);
    const definition = fixture("/project");
    repository.synchronizeDefinition(definition, 1, 1_000);
    repository.createRun({
      id: "run-question",
      definition,
      definitionVersion: 1,
      trigger: "manual",
      scheduledFor: 1_000,
      occurrenceKey: "automation-1:manual:run-question",
    });
    repository.patchRun("run-question", { rootSessionID: "session-1", state: "running" });
    const onAttention = vi.fn();
    const runner = new AutomationRunner({
      client: async () => ({}) as OpenCodeClient,
      repository,
      memory: memoryStore(),
      onChanged: vi.fn(),
      onFinished: vi.fn(),
      onAttention,
    });
    runner.rememberSession("run-question", "session-1");

    runner.onEvent({
      type: "form.created",
      data: {
        form: {
          id: "question-1",
          sessionID: "session-1",
          metadata: { kind: "question" },
        },
      },
    } as unknown as Parameters<AutomationRunner["onEvent"]>[0]);

    expect(repository.run("run-question")?.attention).toMatchObject({
      type: "question",
      requestID: "question-1",
      sessionID: "session-1",
    });
    expect(onAttention).toHaveBeenCalledTimes(1);
    sqlite.close();
  });

  it("records authoritative live execution timestamps", () => {
    const sqlite = new DatabaseSync(":memory:");
    const database = drizzle({ client: sqlite });
    migrate(database, { migrationsFolder: path.resolve("drizzle") });
    const repository = new AutomationRepository(database);
    const definition = fixture("/project");
    repository.synchronizeDefinition(definition, 1, 1_000);
    repository.createRun({
      id: "run-timing",
      definition,
      definitionVersion: 1,
      trigger: "manual",
      scheduledFor: 1_000,
      occurrenceKey: "automation-1:manual:run-timing",
    });
    const runner = new AutomationRunner({
      client: async () => ({}) as OpenCodeClient,
      repository,
      memory: memoryStore(),
      onChanged: vi.fn(),
      onFinished: vi.fn(),
      onAttention: vi.fn(),
    });
    runner.rememberSession("run-timing", "session-1");
    repository.patchRun("run-timing", { state: "running" });

    runner.onEvent(executionEvent("session.execution.started", 10));
    runner.onEvent(executionEvent("session.execution.succeeded", 40));

    expect(repository.run("run-timing")).toMatchObject({
      executionStartedAt: 10,
      executionCompletedAt: 40,
    });
    sqlite.close();
  });

  it("ignores live execution events before the automation prompt is admitted", () => {
    const sqlite = new DatabaseSync(":memory:");
    const database = drizzle({ client: sqlite });
    migrate(database, { migrationsFolder: path.resolve("drizzle") });
    const repository = new AutomationRepository(database);
    const definition = fixture("/project");
    repository.synchronizeDefinition(definition, 1, 1_000);
    repository.createRun({
      id: "run-preparing",
      definition,
      definitionVersion: 1,
      trigger: "manual",
      scheduledFor: 1_000,
      occurrenceKey: "automation-1:manual:run-preparing",
    });
    repository.patchRun("run-preparing", { state: "preparing" });
    const runner = new AutomationRunner({
      client: async () => ({}) as OpenCodeClient,
      repository,
      memory: memoryStore(),
      onChanged: vi.fn(),
      onFinished: vi.fn(),
      onAttention: vi.fn(),
    });
    runner.rememberSession("run-preparing", "session-1");

    runner.onEvent(executionEvent("session.execution.started", 10));
    runner.onEvent(executionEvent("session.execution.succeeded", 20));

    expect(repository.run("run-preparing")).toMatchObject({
      executionStartedAt: null,
      executionCompletedAt: null,
    });
    sqlite.close();
  });
});

describe("AutomationRunner worktrees", () => {
  const directory = "/server/worktrees/palot-auto-automati-1000";

  function setup() {
    const sqlite = new DatabaseSync(":memory:");
    const database = drizzle({ client: sqlite });
    migrate(database, { migrationsFolder: path.resolve("drizzle") });
    const repository = new AutomationRepository(database);
    const definition: AutomationDefinition = {
      ...fixture("/server/repo/nested"),
      // Stop at configuration validation after resolving and persisting the workspace.
      action: { prompt: "Review changes", agent: "missing-agent", model: null, skills: [] },
      destination: {
        type: "standalone",
        projectID: "cached-project",
        sourceDirectory: "/server/repo/nested",
        workspace: { type: "new-worktree" },
      },
    };
    repository.synchronizeDefinition(definition, 1, 1_000);
    repository.createRun({
      id: "run-worktree",
      definition,
      definitionVersion: 1,
      trigger: "manual",
      scheduledFor: 1_000,
      occurrenceKey: "automation-1:manual:run-worktree",
    });
    const list = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockResolvedValue({ directory });
    const agents = vi.fn().mockResolvedValue({ data: [] });
    const sessionCreate = vi.fn();
    const client = {
      worktree: { list, create },
      agent: { list: agents },
      model: { list: vi.fn().mockResolvedValue({ data: [] }) },
      skill: { list: vi.fn().mockResolvedValue({ data: [] }) },
      session: { create: sessionCreate },
    } as unknown as OpenCodeClient;
    const runner = new AutomationRunner({
      client: async () => client,
      repository,
      memory: memoryStore(),
      capabilities: () => ({ localPathActions: false, worktreeCreate: true }),
      onChanged: vi.fn(),
      onFinished: vi.fn(),
      onAttention: vi.fn(),
    });
    return { sqlite, repository, runner, list, create, agents, sessionCreate };
  }

  it("uses the source location and server directory while retaining Git recovery semantics", async () => {
    const test = setup();
    try {
      await test.runner.execute("run-worktree");

      expect(test.list).toHaveBeenCalledExactlyOnceWith(
        { location: { directory: "/server/repo/nested" } },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(test.create).toHaveBeenCalledExactlyOnceWith(
        {
          location: { directory: "/server/repo/nested" },
          strategy: "git",
          name: "palot-auto-automati-1000",
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(test.agents).toHaveBeenCalledWith({ location: { directory } }, expect.anything());
      expect(test.repository.run("run-worktree")).toMatchObject({
        worktreeDirectory: directory,
        state: "needs-attention",
      });

      await test.runner.execute("run-worktree");
      expect(test.create).toHaveBeenCalledTimes(1);
      expect(test.list).toHaveBeenCalledTimes(1);
    } finally {
      test.sqlite.close();
    }
  });

  it("reconciles a timed-out create through location discovery instead of creating twice", async () => {
    const test = setup();
    test.create.mockRejectedValue(new Error("request timed out"));
    test.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ directory, strategy: "git" }]);
    try {
      await test.runner.execute("run-worktree");

      expect(test.create).toHaveBeenCalledTimes(1);
      expect(test.list).toHaveBeenCalledTimes(2);
      expect(test.list).toHaveBeenLastCalledWith(
        { location: { directory: "/server/repo/nested" } },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(test.repository.run("run-worktree")).toMatchObject({
        worktreeDirectory: directory,
        state: "needs-attention",
      });
      expect(test.agents).toHaveBeenCalledWith({ location: { directory } }, expect.anything());
    } finally {
      test.sqlite.close();
    }
  });

  it("recovers an existing Git worktree before attempting creation", async () => {
    const test = setup();
    test.list.mockResolvedValue([{ directory, strategy: "git" }]);
    try {
      await test.runner.execute("run-worktree");

      expect(test.create).not.toHaveBeenCalled();
      expect(test.repository.run("run-worktree")?.worktreeDirectory).toBe(directory);
      expect(test.agents).toHaveBeenCalledWith({ location: { directory } }, expect.anything());
    } finally {
      test.sqlite.close();
    }
  });

  it("does not adopt another strategy's same-name directory or retry an unproven create", async () => {
    const test = setup();
    test.list.mockResolvedValue([{ directory, strategy: "custom" }]);
    test.create.mockRejectedValue(new Error("request timed out"));
    try {
      await test.runner.execute("run-worktree");

      expect(test.create).toHaveBeenCalledTimes(1);
      expect(test.repository.run("run-worktree")).toMatchObject({
        worktreeDirectory: null,
        state: "failed",
        error: { message: "request timed out" },
      });
      expect(test.agents).not.toHaveBeenCalled();
      expect(test.sessionCreate).not.toHaveBeenCalled();
    } finally {
      test.sqlite.close();
    }
  });
});

function runInput(runID: string, created: number): SessionMessageInfo {
  return {
    id: `user-${runID}`,
    type: "user",
    text: "Run scheduled work",
    metadata: { "palot.automation": { version: 1, runID } },
    time: { created },
  };
}

function executionEvent(
  type: "session.execution.started" | "session.execution.succeeded",
  created: number,
): Parameters<AutomationRunner["onEvent"]>[0] {
  return {
    id: `${type}-${created}`,
    type,
    created,
    durable: { aggregateID: "session-1", seq: created, version: 1 },
    data: { sessionID: "session-1" },
  } as Parameters<AutomationRunner["onEvent"]>[0];
}

function assistant(input: {
  created: number;
  completed?: number;
  finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown";
  error?: { type: string; message: string };
}): SessionMessageInfo {
  return {
    id: `assistant-${input.created}`,
    type: "assistant",
    agent: "build",
    model: { id: "test-model", providerID: "test" },
    content: [],
    time: { created: input.created, ...(input.completed ? { completed: input.completed } : {}) },
    ...(input.finish ? { finish: input.finish } : {}),
    ...(input.error ? { error: input.error } : {}),
  };
}

function fixture(directory: string): AutomationDefinition {
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
      sourceDirectory: directory,
      workspace: { type: "current" },
    },
    trigger: {
      version: 1,
      type: "once",
      at: 1_000,
      timezone: "UTC",
    },
    missedRuns: { type: "skip" },
    notifications: "failures-only",
    createdFromSessionID: null,
    createdAt: 100,
    updatedAt: 100,
  };
}

function memoryStore() {
  return {
    ensure: vi.fn().mockResolvedValue("/automations/automation-1/memory.md"),
  };
}
