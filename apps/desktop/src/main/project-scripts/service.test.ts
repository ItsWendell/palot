// @vitest-environment node

import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectScriptRun } from "../../shared/project-scripts-contract";
import { SessionTriageStore } from "../session-triage-store";
import { ProjectScriptRepository } from "./repository";
import { ProjectScriptsService, type SettledTask } from "./service";
import type { ScriptProcessInput, ScriptProcessResult } from "./runner";

const target = { profileID: "local", projectID: "project-1" };
const draft = { name: "test", command: "bun test", runOnSettle: true, timeoutSeconds: 60 };
const through = { updatedAt: 100, sessionID: "session-1" };

describe("ProjectScriptsService", () => {
  let sqlite: DatabaseSync;
  let root: string;
  let checkout: string;
  let worktree: string;
  let runs: ProjectScriptRun[];
  let processes: ScriptProcessInput[];
  let task: SettledTask;
  let local: boolean | null;
  let service: ProjectScriptsService;
  let triage: SessionTriageStore;
  let pending: Promise<void>[];
  let log: {
    info: ReturnType<typeof vi.fn<(message: string) => void>>;
    warn: ReturnType<typeof vi.fn<(...data: unknown[]) => void>>;
  };

  beforeEach(async () => {
    sqlite = new DatabaseSync(":memory:");
    const database = drizzle({ client: sqlite });
    migrate(database, { migrationsFolder: path.resolve("drizzle") });
    root = await realpath(await mkdtemp(path.join(tmpdir(), "palot-scripts-")));
    checkout = path.join(root, "repo");
    worktree = path.join(root, "worktrees", "feature");
    await mkdir(path.join(checkout, "packages", "web"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    runs = [];
    processes = [];
    pending = [];
    log = { info: vi.fn<(message: string) => void>(), warn: vi.fn<(...data: unknown[]) => void>() };
    local = true;
    task = {
      directory: worktree,
      projects: [{ id: target.projectID, canonical: checkout, sandboxes: [worktree] }],
    };
    let id = 0;
    service = new ProjectScriptsService({
      repository: new ProjectScriptRepository(database, () => `script-${++id}`),
      isLocalProfile: () => local,
      resolveTask: async () => task,
      runProcess: async (input): Promise<ScriptProcessResult> => {
        processes.push(input);
        return {
          status: "passed",
          exitCode: 0,
          signal: null,
          output: "ok\n",
          outputTruncated: false,
          error: null,
        };
      },
      emit: (run) => runs.push(run),
      log,
      now: () => 1_000,
      createID: () => `run-${runs.length + 1}`,
    });
    triage = new SessionTriageStore(database, (event) =>
      pending.push(service.handleSettled(event)),
    );
  });

  afterEach(async () => {
    sqlite.close();
    await rm(root, { recursive: true, force: true });
  });

  const settle = async (at: number, watermark = through) => {
    triage.dispatch({ type: "settle", ...target, sessionID: "session-1", at, through: watermark });
    await Promise.all(pending.splice(0));
  };

  it("adds, edits, orders and removes scripts per profile and project", () => {
    expect(service.load(target)).toEqual({
      ...target,
      scripts: [],
      availability: { supported: true },
    });
    service.save({ ...target, script: { ...draft, name: "  test  " } });
    const { scripts } = service.save({
      ...target,
      script: { ...draft, name: "lint", command: "bun run lint" },
    });
    expect(scripts.map((script) => [script.id, script.name])).toEqual([
      ["script-1", "test"],
      ["script-2", "lint"],
    ]);
    service.save({ ...target, script: { ...draft, id: "script-1", command: "bun test --bail" } });
    expect(service.load(target).scripts[0]).toMatchObject({
      id: "script-1",
      command: "bun test --bail",
    });
    expect(service.load({ ...target, projectID: "other" }).scripts).toEqual([]);
    expect(service.load({ ...target, profileID: "other" }).scripts).toEqual([]);
    expect(service.remove({ ...target, scriptID: "script-1" }).scripts.map((s) => s.id)).toEqual([
      "script-2",
    ]);
    expect(() => service.save({ ...target, script: { ...draft, id: "script-1" } })).toThrow(
      "no longer exists",
    );
    expect(() => service.save({ ...target, script: { ...draft, command: "   " } })).toThrow(
      "Enter a command",
    );
  });

  it("refuses to save scripts for remote connections and reports why", () => {
    local = false;
    expect(service.load(target).availability).toEqual({
      supported: false,
      reason: expect.stringContaining("only available for local OpenCode connections"),
    });
    expect(() => service.save({ ...target, script: draft })).toThrow("local OpenCode connections");
  });

  it("runs a configured settle script once per settlement in the task's directory", async () => {
    service.save({ ...target, script: draft });
    service.save({ ...target, script: { ...draft, name: "manual", runOnSettle: false } });

    await settle(200);
    expect(processes).toHaveLength(1);
    expect(processes[0]).toMatchObject({ command: "bun test", cwd: worktree, timeoutMs: 60_000 });
    expect(processes[0]!.env).toMatchObject({
      PALOT_TASK_ID: "session-1",
      PALOT_TASK_DIRECTORY: worktree,
    });
    expect(runs).toEqual([
      expect.objectContaining({
        trigger: "settle",
        sessionID: "session-1",
        scriptName: "test",
        directory: worktree,
        status: "passed",
        output: "ok\n",
      }),
    ]);

    // A replayed settle, and settling again after Undo without new activity, do not rerun.
    await settle(201);
    triage.dispatch({ type: "inbox", ...target, sessionID: "session-1", at: 300 });
    await settle(400);
    expect(processes).toHaveLength(1);

    // New activity makes it a new settlement.
    await settle(500, { updatedAt: 450, sessionID: "session-1" });
    expect(processes).toHaveLength(2);
  });

  it("never runs without a configured script or on a remote connection", async () => {
    await settle(200);
    expect(processes).toEqual([]);
    expect(log.info).toHaveBeenLastCalledWith(
      "Settle scripts skipped for session-1 on local: no settle scripts on this connection",
    );

    service.save({ ...target, script: draft });
    local = false;
    await settle(300, { updatedAt: 250, sessionID: "session-1" });
    expect(processes).toEqual([]);
    expect(runs).toEqual([]);
    expect(log.info).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Settle scripts skipped for session-1 on local: .*local OpenCode/),
    );
  });

  it("uses the project Palot shows the task under when the session reports an enclosing one", async () => {
    // Regression: a nested repository's task is shown (and configured) under the project
    // OpenCode resolves for its directory, while the session reports the enclosing repository.
    service.save({ ...target, script: draft });
    task = {
      directory: worktree,
      projects: [
        { id: target.projectID, canonical: worktree, sandboxes: [] },
        { id: "enclosing-repo", canonical: root, sandboxes: [] },
      ],
    };
    await settle(200);
    expect(processes.map((input) => input.cwd)).toEqual([worktree]);
    expect(runs[0]).toMatchObject({ projectID: target.projectID, status: "passed" });

    // The directory's project wins when both have settle scripts; only one set runs.
    service.save({
      profileID: "local",
      projectID: "enclosing-repo",
      script: { ...draft, name: "outer" },
    });
    await settle(300, { updatedAt: 250, sessionID: "session-1" });
    expect(runs.map((run) => run.scriptName)).toEqual(["test", "test"]);

    // Without scripts of its own, the session's project is the fallback.
    service.remove({ ...target, scriptID: "script-1" });
    await settle(400, { updatedAt: 350, sessionID: "session-1" });
    expect(runs.at(-1)).toMatchObject({ projectID: "enclosing-repo", scriptName: "outer" });
  });

  it("accepts subdirectories of the main checkout", async () => {
    service.save({ ...target, script: draft });
    task = { ...task, directory: path.join(checkout, "packages", "web") };
    await settle(200);
    expect(processes[0]?.cwd).toBe(path.join(checkout, "packages", "web"));
  });

  it.each([
    ["outside the project", async () => path.join(root, "elsewhere")],
    [
      "a symlink escaping the project",
      async () => {
        await mkdir(path.join(root, "elsewhere"), { recursive: true });
        await symlink(path.join(root, "elsewhere"), path.join(worktree, "escape"));
        return path.join(worktree, "escape");
      },
    ],
    ["missing", async () => path.join(worktree, "gone")],
  ])("reports and skips a task directory %s", async (_label, directory) => {
    await mkdir(path.join(root, "elsewhere"), { recursive: true });
    service.save({ ...target, script: draft });
    task = { ...task, directory: await directory() };
    await settle(200);
    expect(processes).toEqual([]);
    expect(runs).toEqual([
      expect.objectContaining({ status: "error", directory: null, error: expect.any(String) }),
    ]);
  });

  it("reports failures and timeouts from the process", async () => {
    const results: ScriptProcessResult[] = [
      {
        status: "failed",
        exitCode: 2,
        signal: null,
        output: "boom",
        outputTruncated: false,
        error: null,
      },
      {
        status: "timed-out",
        exitCode: null,
        signal: "SIGTERM",
        output: "",
        outputTruncated: false,
        error: "Stopped after 60 seconds.",
      },
    ];
    const emitted: ProjectScriptRun[] = [];
    const failing = new ProjectScriptsService({
      repository: new ProjectScriptRepository(drizzle({ client: sqlite })),
      isLocalProfile: () => true,
      resolveTask: async () => task,
      runProcess: async () => results.shift()!,
      emit: (run) => emitted.push(run),
      log: { info: vi.fn(), warn: vi.fn() },
    });
    failing.save({ ...target, script: draft });
    failing.save({ ...target, script: { ...draft, name: "slow" } });
    await failing.handleSettled({ ...target, sessionID: "session-1", through, batch: null });
    expect(emitted.map((run) => [run.scriptName, run.status, run.exitCode, run.error])).toEqual([
      ["test", "failed", 2, null],
      ["slow", "timed-out", null, "Stopped after 60 seconds."],
    ]);
  });

  it("retries on the next settle when the task could not be read", async () => {
    const resolveTask = vi
      .fn<(profileID: string, sessionID: string) => Promise<SettledTask>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(task);
    const retrying = new ProjectScriptsService({
      repository: new ProjectScriptRepository(drizzle({ client: sqlite })),
      isLocalProfile: () => true,
      resolveTask,
      runProcess: async (input) => {
        processes.push(input);
        return {
          status: "passed",
          exitCode: 0,
          signal: null,
          output: "",
          outputTruncated: false,
          error: null,
        };
      },
      emit: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn() },
    });
    retrying.save({ ...target, script: draft });
    await retrying.handleSettled({ ...target, sessionID: "session-1", through, batch: null });
    expect(processes).toEqual([]);
    await retrying.handleSettled({ ...target, sessionID: "session-1", through, batch: null });
    expect(processes).toHaveLength(1);
  });

  it("runs a batch's settle scripts once per worktree and never in the main checkout", async () => {
    const other = path.join(root, "worktrees", "other");
    await mkdir(other, { recursive: true });
    const directories: Record<string, string> = {
      "session-1": worktree,
      "session-2": worktree,
      "session-3": other,
      "session-4": checkout,
    };
    const database = drizzle({ client: sqlite });
    const batchService = new ProjectScriptsService({
      repository: new ProjectScriptRepository(database),
      isLocalProfile: () => true,
      resolveTask: async (_profileID, sessionID) => ({
        directory: directories[sessionID]!,
        projects: [{ id: target.projectID, canonical: checkout, sandboxes: [worktree, other] }],
      }),
      runProcess: async (input) => {
        processes.push(input);
        return {
          status: "passed",
          exitCode: 0,
          signal: null,
          output: "",
          outputTruncated: false,
          error: null,
        };
      },
      emit: (run) => runs.push(run),
      log: { info: vi.fn(), warn: vi.fn() },
    });
    batchService.save({ ...target, script: draft });
    const batchTriage = new SessionTriageStore(database, (event) =>
      pending.push(batchService.handleSettled(event)),
    );
    batchTriage.dispatch({
      type: "settle-many",
      profileID: target.profileID,
      at: 200,
      trigger: "bulk",
      sessions: Object.keys(directories).map((sessionID) => ({
        sessionID,
        through: { updatedAt: 100, sessionID },
      })),
    });
    await Promise.all(pending.splice(0));
    expect(processes.map((input) => input.cwd).toSorted()).toEqual([other, worktree].toSorted());
    expect(runs).toHaveLength(2);

    // A single settle from the row still runs in the main checkout.
    batchTriage.dispatch({ type: "inbox", ...target, sessionID: "session-4", at: 300 });
    batchTriage.dispatch({
      type: "settle",
      ...target,
      sessionID: "session-4",
      at: 400,
      through: { updatedAt: 350, sessionID: "session-4" },
    });
    await Promise.all(pending.splice(0));
    expect(processes.at(-1)?.cwd).toBe(checkout);
  });
});
