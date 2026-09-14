import { access } from "node:fs/promises";
import path from "node:path";
import type {
  OpenCodeClient,
  OpenCodeEvent,
  SessionMessageAssistant,
  SessionMessageInfo,
} from "@opencode/client";
import type {
  AutomationDefinition,
  AutomationRun,
  AutomationRunState,
  OpenCodeRuntimeCapabilities,
} from "../../shared";
import { sessionTriageStore } from "../session-triage-store";
import { AutomationRepository } from "./repository";

const REQUEST_TIMEOUT_MS = 30_000;
const SETTLE_DELAY_MS = 350;
const SUMMARY_LIMIT = 320;
const AUTOMATION_INSTRUCTION_KEY = "palot.automation";

type TerminalOutcome = "succeeded" | "failed" | "interrupted" | "unknown";

class UnknownAdmissionError extends Error {}
export class AutomationConfigurationError extends Error {}

interface AutomationRunnerOptions {
  client(): Promise<OpenCodeClient>;
  repository: AutomationRepository;
  memory: {
    ensure(automationID: string): Promise<string>;
  };
  capabilities?(): Pick<OpenCodeRuntimeCapabilities, "localPathActions" | "worktreeCreate">;
  onChanged(): void;
  onFinished(run: AutomationRun, definition: AutomationDefinition): void;
  onAttention(run: AutomationRun, definition: AutomationDefinition): void;
}

export function automationSessionInstructions(input: {
  definition: AutomationDefinition;
  run: AutomationRun;
  memoryPath: string | null;
  lastRunAt: number | null;
}): string {
  const lastRun = input.lastRunAt === null ? "never" : new Date(input.lastRunAt).toISOString();
  const memory = input.memoryPath
    ? `Automation memory: ${input.memoryPath}

Use the memory file for continuity between this automation's standalone runs. Read it first to avoid repeating recent work. Before returning, update it with a concise summary of what you did or decided, unfinished work, and the current run time.

Only the root automation session updates the memory file. Child or subagent sessions should report their findings to the root session and must not write automation memory directly.`
    : `Persistent cross-run file memory is unavailable on this server. This standalone run does not share a memory file with earlier runs. Use this task's transcript for context; do not assume previous runs are available.`;
  return `## Palot automation

Automation ID: ${input.definition.id}
Run ID: ${input.run.id}
Last run: ${lastRun}

${memory}

Store requested code changes and deliverables in the current workspace according to the project's instructions. Do not invent project-level artifact folders or conventions.`;
}

export class AutomationRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly executions = new Map<string, Promise<void>>();
  private readonly sessionRuns = new Map<string, string>();
  private readonly sessionOutcomes = new Map<string, TerminalOutcome>();
  private readonly memoryDirectories = new Map<string, string>();
  private stopping = false;

  constructor(private readonly options: AutomationRunnerOptions) {}

  runIDForSession(sessionID: string): string | null {
    return this.sessionRuns.get(sessionID) ?? null;
  }

  isExecuting(runID: string): boolean {
    return this.executions.has(runID);
  }

  rememberSession(runID: string, sessionID: string): void {
    this.sessionRuns.set(sessionID, runID);
  }

  async execute(runID: string): Promise<void> {
    if (this.stopping) return;
    const active = this.executions.get(runID);
    if (active) return active;
    const execution = this.executeRun(runID);
    this.executions.set(runID, execution);
    try {
      await execution;
    } finally {
      if (this.executions.get(runID) === execution) this.executions.delete(runID);
    }
  }

  private async executeRun(runID: string): Promise<void> {
    const run = this.options.repository.run(runID);
    const definition = this.options.repository.runDefinition(runID);
    if (!run || !definition) return;
    const controller = new AbortController();
    this.controllers.set(runID, controller);
    try {
      await this.executeDefinition(run, definition, controller.signal);
    } catch (error) {
      if (this.stopping) return;
      if (controller.signal.aborted) {
        this.finish(run, definition, "cancelled", {
          code: "cancelled",
          message: "The scheduled run was cancelled.",
        });
      } else if (error instanceof UnknownAdmissionError) {
        this.finish(run, definition, "unknown", {
          code: "admission_unknown",
          message: error.message,
        });
      } else if (error instanceof AutomationConfigurationError) {
        const current = this.options.repository.run(run.id);
        const attention = this.options.repository.patchRun(run.id, {
          state: "needs-attention",
          attention: {
            type: "configuration",
            sessionID: current?.rootSessionID ?? run.rootSessionID,
            requestID: null,
            message: error.message,
          },
          error: { code: "configuration", message: error.message },
        });
        this.options.repository.recordStartFailure(definition.id);
        this.options.onChanged();
        if (attention) this.options.onAttention(attention, definition);
      } else {
        this.finish(run, definition, "failed", {
          code: "execution_failed",
          message: error instanceof Error ? error.message : "The scheduled run failed.",
        });
      }
    } finally {
      this.controllers.delete(runID);
    }
  }

  async recover(run: AutomationRun): Promise<void> {
    if (run.rootSessionID) this.rememberSession(run.id, run.rootSessionID);
    await this.execute(run.id);
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    for (const controller of this.controllers.values()) {
      controller.abort(new Error("Palot is shutting down"));
    }
    await Promise.allSettled(this.executions.values());
    this.controllers.clear();
    this.executions.clear();
    this.sessionRuns.clear();
    this.sessionOutcomes.clear();
    this.memoryDirectories.clear();
  }

  async cancelAll(reason = "OpenCode profile changed"): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort(new Error(reason));
    await Promise.allSettled(this.executions.values());
  }

  async cancel(runID: string): Promise<void> {
    const controller = this.controllers.get(runID);
    controller?.abort(new Error("Scheduled run cancelled"));
    const run = this.options.repository.run(runID);
    if (!run?.rootSessionID) return;
    const client = await this.options.client();
    if (run.inboxID && run.state === "queued") {
      await client.session.inbox.cancel(
        { sessionID: run.rootSessionID, inboxID: run.inboxID },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      return;
    }
    const sessions = await this.sessionTree(
      client,
      run.rootSessionID,
      run.startedAt ?? run.createdAt,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    );
    await Promise.allSettled(
      sessions.map((sessionID) =>
        client.session.interrupt(
          { sessionID },
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        ),
      ),
    );
  }

  onEvent(event: OpenCodeEvent): void {
    if (
      event.type === "session.execution.started" ||
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    ) {
      const runID = this.sessionRuns.get(event.data.sessionID);
      const run = runID ? this.options.repository.run(runID) : null;
      const admitted = Boolean(
        runID &&
        run &&
        run.state !== "pending" &&
        run.state !== "preparing" &&
        run.state !== "queued",
      );
      if (runID && admitted) {
        this.options.repository.recordExecutionEvent(
          runID,
          event.type === "session.execution.started" ? "started" : "completed",
          event.created,
        );
        this.options.onChanged();
      }
      if (admitted && event.type !== "session.execution.started") {
        this.sessionOutcomes.set(event.data.sessionID, terminalEventOutcome(event));
      }
      return;
    }
    if (event.type === "session.created") {
      const sessionID = event.data.sessionID;
      const parentID = event.data.parentID;
      const runID = parentID ? this.sessionRuns.get(parentID) : null;
      if (runID) this.rememberSession(runID, sessionID);
      return;
    }
    if (event.type === "permission.asked") {
      const sessionID = event.data.sessionID;
      const runID = this.sessionRuns.get(sessionID);
      if (!runID) return;
      const memoryDirectory = this.memoryDirectories.get(runID);
      if (
        event.data.action === "external_directory" &&
        memoryDirectory &&
        isAutomationMemoryPermission(event.data.resources, memoryDirectory)
      ) {
        void this.approveAutomationMemoryPermission(runID, event.data);
        return;
      }
      this.setAttention(runID, {
        type: "permission",
        sessionID,
        requestID: event.data.id,
        message: "OpenCode is waiting for permission.",
      });
      return;
    }
    if (event.type === "form.created") {
      const form = event.data.form;
      const sessionID = form.sessionID;
      const runID = this.sessionRuns.get(sessionID);
      if (!runID) return;
      const question = form.metadata?.kind === "question";
      this.setAttention(runID, {
        type: question ? "question" : "form",
        sessionID,
        requestID: form.id,
        message: question ? "OpenCode is waiting for an answer." : "OpenCode is waiting for input.",
      });
      return;
    }
    if (
      event.type === "permission.replied" ||
      event.type === "form.replied" ||
      event.type === "form.cancelled"
    ) {
      const sessionID = event.data.sessionID;
      const runID = this.sessionRuns.get(sessionID);
      if (!runID) return;
      void this.reconcileRunAttention(runID);
    }
  }

  private async executeDefinition(
    run: AutomationRun,
    definition: AutomationDefinition,
    signal: AbortSignal,
  ): Promise<void> {
    const client = await this.options.client();
    const startedAt = run.startedAt ?? Date.now();
    const retainedAttention = run.attention?.type === "question" ? run.attention : null;
    this.options.repository.patchRun(run.id, {
      state: retainedAttention ? "needs-attention" : "preparing",
      startedAt,
      error: null,
      attention: retainedAttention,
    });
    this.options.onChanged();

    let sessionID = run.rootSessionID;
    if (!sessionID) {
      if (definition.destination.type === "standalone") {
        const location = await this.resolveLocation(client, definition, run, signal);
        await this.validateStandaloneConfiguration(client, definition, location, signal);
        const id = automationSessionID(run.id);
        const input = {
          id,
          title: `${definition.name} · Scheduled`,
          ...(definition.action.agent ? { agent: definition.action.agent } : {}),
          ...(definition.action.model ? { model: definition.action.model } : {}),
          location: { directory: location },
        };
        const session = await client.session
          .create(input, { signal: requestSignal(signal) })
          .catch(async (error) => {
            const existing = await client.session
              .get({ sessionID: id }, { signal: requestSignal(signal) })
              .catch(() => null);
            if (existing) return existing;
            throw error;
          });
        sessionID = session.id;
      } else {
        const session = await client.session
          .get({ sessionID: definition.destination.sessionID }, { signal: requestSignal(signal) })
          .catch(() => {
            throw new AutomationConfigurationError("The target task is unavailable.");
          });
        if (session.time.archived) {
          throw new AutomationConfigurationError("The target task is archived.");
        }
        const [permissions, forms] = await Promise.all([
          client.permission.list({ sessionID: session.id }, { signal: requestSignal(signal) }),
          client.form.list({ sessionID: session.id }, { signal: requestSignal(signal) }),
        ]);
        if (permissions.length || forms.length) {
          throw new AutomationConfigurationError("The target task already needs attention.");
        }
        sessionID = session.id;
      }
      this.rememberSession(run.id, sessionID);
      this.options.repository.patchRun(run.id, { rootSessionID: sessionID });
      this.options.onChanged();
    } else {
      this.rememberSession(run.id, sessionID);
    }

    if (definition.destination.type === "standalone") {
      const previousRun = this.options.repository.previousRun(definition.id, run.id);
      // The registry lives on the desktop. The official filesystem API cannot create a
      // corresponding remote file, so never expose or auto-approve its path remotely.
      const memoryPath = this.capabilities().localPathActions
        ? await this.options.memory.ensure(definition.id)
        : null;
      if (memoryPath) this.memoryDirectories.set(run.id, path.dirname(memoryPath));
      else this.memoryDirectories.delete(run.id);
      await client.session.instructions.entry.put(
        {
          sessionID,
          key: AUTOMATION_INSTRUCTION_KEY,
          value: automationSessionInstructions({
            definition,
            run,
            memoryPath,
            lastRunAt: previousRun?.completedAt ?? previousRun?.scheduledFor ?? null,
          }),
        },
        { signal: requestSignal(signal) },
      );
    }

    let admission = await this.findAdmission(client, sessionID, run.id, signal);
    const currentRun = this.options.repository.run(run.id);
    if (!currentRun || !(sessionID in currentRun.sessionCursors)) {
      await this.captureSessionCursor(client, sessionID, run.id, signal);
    }
    if (!admission) {
      this.sessionOutcomes.delete(sessionID);
      try {
        const pending = await client.session.prompt(
          {
            sessionID,
            text: definition.action.prompt,
            ...(definition.action.skills.length
              ? { skills: definition.action.skills.map((id) => ({ id })) }
              : {}),
            metadata: {
              "palot.automation": {
                version: 1,
                automationID: definition.id,
                runID: run.id,
                scheduledFor: run.scheduledFor,
                trigger: run.trigger,
              },
            },
            delivery: definition.destination.type === "session" ? "queue" : "steer",
          },
          { signal: requestSignal(signal) },
        );
        admission = { inboxID: pending.id, delivery: pending.delivery, delivered: false };
      } catch (error) {
        await wait(SETTLE_DELAY_MS, signal);
        admission = await this.findAdmission(client, sessionID, run.id, signal);
        if (!admission) {
          throw new UnknownAdmissionError(
            `Palot could not prove whether OpenCode accepted this run: ${
              error instanceof Error ? error.message : "the prompt request failed"
            }`,
          );
        }
      }
    }

    this.options.repository.patchRun(run.id, {
      state: admission.delivered || admission.delivery === "steer" ? "running" : "queued",
      inboxID: admission.inboxID,
    });
    this.options.repository.resetStartFailures(definition.id);
    if (definition.destination.type === "session") {
      sessionTriageStore().dispatch({
        type: "wake",
        profileID: definition.profileID,
        sessionID: definition.destination.sessionID,
        at: Date.now(),
      });
    }
    this.options.onChanged();

    await this.waitForRootExecution(client, run.id, sessionID, startedAt, signal);
    this.options.repository.patchRun(run.id, { state: "settling", attention: null });
    this.options.onChanged();
    const sessions = await this.waitForRunTree(client, run.id, sessionID, startedAt, signal);
    const outcome = await this.runTreeOutcome(client, sessions, run.id, startedAt, signal);
    const summary = await this.resultSummary(client, sessionID, run.id, signal);
    if (outcome === "succeeded") {
      this.finish(run, definition, "succeeded", null, summary);
      return;
    }
    if (outcome === "interrupted") {
      this.finish(run, definition, "interrupted", {
        code: "interrupted",
        message: "OpenCode interrupted the scheduled run.",
      });
      return;
    }
    if (outcome === "failed") {
      this.finish(run, definition, "failed", {
        code: "agent_failed",
        message: "OpenCode reported a failed execution.",
      });
      return;
    }
    this.finish(run, definition, "unknown", {
      code: "outcome_unknown",
      message: "Palot could not establish a terminal outcome from OpenCode's persisted state.",
    });
  }

  private async findAdmission(
    client: OpenCodeClient,
    sessionID: string,
    runID: string,
    signal: AbortSignal,
  ): Promise<{ inboxID: string | null; delivery: "steer" | "queue"; delivered: boolean } | null> {
    const [inbox, messages] = await Promise.all([
      client.session.inbox.list({ sessionID }, { signal: requestSignal(signal) }),
      this.messagesForRun(client, sessionID, runID, signal),
    ]);
    const pending = inbox.find(
      (item) =>
        item.type === "user" &&
        objectValue(item.payload.metadata?.["palot.automation"])?.runID === runID,
    );
    if (pending?.type === "user") {
      return { inboxID: pending.id, delivery: pending.delivery, delivered: false };
    }
    const delivered = messages.some(
      (message) =>
        message.type === "user" &&
        objectValue(message.metadata?.["palot.automation"])?.runID === runID,
    );
    return delivered ? { inboxID: null, delivery: "steer", delivered: true } : null;
  }

  private async waitForRootExecution(
    client: OpenCodeClient,
    runID: string,
    sessionID: string,
    startedAt: number,
    signal: AbortSignal,
  ): Promise<void> {
    while (true) {
      const sessions = await this.sessionTree(client, sessionID, startedAt, signal);
      for (const value of sessions) this.rememberSession(runID, value);
      await this.reconcileAttention(client, runID, sessions, signal);
      await client.session.wait({ sessionID }, { signal });
      const outcome = await this.sessionOutcome(client, sessionID, runID, startedAt, signal, false);
      if (outcome !== "unknown") return;
      const admission = await this.findAdmission(client, sessionID, runID, signal);
      this.options.repository.patchRun(runID, {
        state:
          admission && !admission.delivered && admission.delivery === "queue"
            ? "queued"
            : "running",
        ...(admission ? { inboxID: admission.inboxID } : {}),
      });
      this.options.onChanged();
      await wait(SETTLE_DELAY_MS, signal);
    }
  }

  private async reconcileRunAttention(runID: string): Promise<void> {
    const run = this.options.repository.run(runID);
    if (!run?.rootSessionID || this.stopping) return;
    try {
      const client = await this.options.client();
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const sessions = await this.sessionTree(
        client,
        run.rootSessionID,
        run.startedAt ?? run.createdAt,
        signal,
      );
      await this.reconcileAttention(client, runID, sessions, signal);
    } catch {
      // The normal monitor or reconnect recovery will reconcile again.
    }
  }

  private async approveAutomationMemoryPermission(
    runID: string,
    request: { id: string; sessionID: string },
  ): Promise<void> {
    try {
      const client = await this.options.client();
      await this.replyAutomationMemoryPermission(
        client,
        request,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      );
    } catch {
      this.setAttention(runID, {
        type: "permission",
        sessionID: request.sessionID,
        requestID: request.id,
        message: "OpenCode is waiting for automation memory access.",
      });
    }
  }

  private async replyAutomationMemoryPermission(
    client: OpenCodeClient,
    request: { id: string; sessionID: string },
    signal: AbortSignal,
  ): Promise<void> {
    await client.permission.reply(
      { sessionID: request.sessionID, requestID: request.id, reply: "once" },
      { signal: requestSignal(signal) },
    );
  }

  private async reconcileAttention(
    client: OpenCodeClient,
    runID: string,
    sessionIDs: string[],
    signal: AbortSignal,
  ): Promise<boolean> {
    for (const sessionID of sessionIDs) {
      const [permissions, forms] = await Promise.all([
        client.permission.list({ sessionID }, { signal: requestSignal(signal) }),
        client.form.list({ sessionID }, { signal: requestSignal(signal) }),
      ]);
      const permission = permissions[0];
      if (permission) {
        const memoryDirectory = this.memoryDirectories.get(runID);
        if (
          permission.action === "external_directory" &&
          memoryDirectory &&
          isAutomationMemoryPermission(permission.resources, memoryDirectory)
        ) {
          await this.replyAutomationMemoryPermission(client, permission, signal);
          continue;
        }
        this.setAttention(runID, {
          type: "permission",
          sessionID,
          requestID: permission.id,
          message: "OpenCode is waiting for permission.",
        });
        return true;
      }
      const form = forms[0];
      if (form) {
        const question = form.metadata?.kind === "question";
        this.setAttention(runID, {
          type: question ? "question" : "form",
          sessionID,
          requestID: form.id,
          message: question
            ? "OpenCode is waiting for an answer."
            : "OpenCode is waiting for input.",
        });
        return true;
      }
    }
    const run = this.options.repository.run(runID);
    if (run?.attention?.type === "question") return true;
    if (run?.state === "needs-attention") {
      this.options.repository.patchRun(runID, { state: "running", attention: null });
      this.options.onChanged();
    }
    return false;
  }

  private async resolveLocation(
    client: OpenCodeClient,
    definition: AutomationDefinition,
    run: AutomationRun,
    signal: AbortSignal,
  ): Promise<string> {
    if (definition.destination.type !== "standalone") throw new Error("Invalid destination");
    const destination = definition.destination;
    const workspace = destination.workspace;
    if (workspace.type === "current") {
      if (this.capabilities().localPathActions) {
        await requireDirectory(destination.sourceDirectory);
      }
      return destination.sourceDirectory;
    }
    if (workspace.type === "existing-worktree") {
      if (this.capabilities().localPathActions) await requireDirectory(workspace.directory);
      return workspace.directory;
    }
    if (!this.capabilities().worktreeCreate) {
      throw new AutomationConfigurationError(
        "Creating automation worktrees is unavailable for the active OpenCode server.",
      );
    }
    const name = `palot-auto-${definition.id.slice(0, 8)}-${run.scheduledFor}`;
    if (run.worktreeDirectory) return run.worktreeDirectory;
    const location = { directory: destination.sourceDirectory };
    const existing = await client.worktree.list({ location }, { signal: requestSignal(signal) });
    const matchesRun = (item: { directory: string; strategy?: string }) =>
      item.strategy === "git" && item.directory.split(/[\\/]/).at(-1) === name;
    const reconciled = existing.find(matchesRun);
    const worktree = reconciled
      ? { directory: reconciled.directory }
      : await client.worktree
          .create(
            {
              location,
              strategy: "git",
              name,
            },
            { signal: requestSignal(signal) },
          )
          .catch(async (error) => {
            const values = await client.worktree.list(
              { location },
              { signal: requestSignal(signal) },
            );
            const value = values.find(matchesRun);
            if (value) return { directory: value.directory };
            throw error;
          });
    this.options.repository.patchRun(run.id, { worktreeDirectory: worktree.directory });
    this.options.onChanged();
    return worktree.directory;
  }

  private capabilities(): Pick<OpenCodeRuntimeCapabilities, "localPathActions" | "worktreeCreate"> {
    return this.options.capabilities?.() ?? { localPathActions: true, worktreeCreate: true };
  }

  private async validateStandaloneConfiguration(
    client: OpenCodeClient,
    definition: AutomationDefinition,
    directory: string,
    signal: AbortSignal,
  ): Promise<void> {
    const location = { directory };
    const [agents, models, skills] = await Promise.all([
      client.agent.list({ location }, { signal: requestSignal(signal) }),
      client.model.list({ location }, { signal: requestSignal(signal) }),
      client.skill.list({ location }, { signal: requestSignal(signal) }),
    ]);
    if (
      definition.action.agent &&
      !agents.data.some((agent) => agent.id === definition.action.agent)
    ) {
      throw new AutomationConfigurationError(
        `The configured agent “${definition.action.agent}” is unavailable.`,
      );
    }
    if (
      definition.action.model &&
      !models.data.some(
        (model) =>
          model.modelID === definition.action.model?.id &&
          model.providerID === definition.action.model.providerID,
      )
    ) {
      throw new AutomationConfigurationError("The configured model is unavailable.");
    }
    const skillIDs = new Set(skills.data.map((skill) => skill.id));
    const missingSkill = definition.action.skills.find((skill) => !skillIDs.has(skill));
    if (missingSkill) {
      throw new AutomationConfigurationError(
        `The configured skill “${missingSkill}” is unavailable.`,
      );
    }
  }

  private async waitForRunTree(
    client: OpenCodeClient,
    runID: string,
    rootSessionID: string,
    startedAt: number,
    signal: AbortSignal,
  ): Promise<string[]> {
    let stable = 0;
    let previous = "";
    let sessions: string[] = [rootSessionID];
    while (stable < 2) {
      sessions = await this.sessionTree(client, rootSessionID, startedAt, signal);
      for (const sessionID of sessions) this.rememberSession(runID, sessionID);
      const needsAttention = await this.reconcileAttention(client, runID, sessions, signal);
      const active = await client.session.active({ signal: requestSignal(signal) });
      const activeSessions = sessions.filter((sessionID) => sessionID in active);
      const run = this.options.repository.run(runID);
      const queuedSessions = (
        await Promise.all(
          sessions.map(async (sessionID) => ({
            sessionID,
            inbox: await client.session.inbox.list(
              { sessionID },
              { signal: requestSignal(signal) },
            ),
          })),
        )
      ).filter(({ sessionID, inbox }) =>
        sessionID === rootSessionID
          ? inbox.some((item) => "id" in item && item.id === run?.inboxID)
          : inbox.some((item) => item.timeCreated >= startedAt),
      );
      if (activeSessions.length) {
        await Promise.all(
          activeSessions.map((sessionID) => client.session.wait({ sessionID }, { signal })),
        );
        stable = 0;
      }
      const signature = sessions.toSorted().join("\0");
      stable =
        signature === previous &&
        activeSessions.length === 0 &&
        queuedSessions.length === 0 &&
        !needsAttention
          ? stable + 1
          : 0;
      previous = signature;
      if (stable < 2) await wait(SETTLE_DELAY_MS, signal);
    }
    return sessions;
  }

  private async sessionTree(
    client: OpenCodeClient,
    rootSessionID: string,
    startedAt: number,
    signal: AbortSignal,
  ): Promise<string[]> {
    const sessions = [rootSessionID];
    let pending = [rootSessionID];
    while (pending.length) {
      const parents = pending;
      pending = [];
      for (const parentID of parents) {
        const children = await client.session.list(
          { parentID, limit: 100, order: "asc" },
          { signal: requestSignal(signal) },
        );
        for (const child of children.data) {
          if (child.time.created < startedAt) continue;
          if (sessions.includes(child.id)) continue;
          sessions.push(child.id);
          pending.push(child.id);
        }
      }
    }
    return sessions;
  }

  private async runTreeOutcome(
    client: OpenCodeClient,
    sessionIDs: string[],
    runID: string,
    startedAt: number,
    signal: AbortSignal,
  ): Promise<TerminalOutcome> {
    const outcomes = await Promise.all(
      sessionIDs.map((sessionID) =>
        this.sessionOutcome(client, sessionID, runID, startedAt, signal),
      ),
    );
    if (outcomes.includes("failed")) return "failed";
    if (outcomes.includes("interrupted")) return "interrupted";
    return outcomes.every((outcome) => outcome === "succeeded") ? "succeeded" : "unknown";
  }

  private async sessionOutcome(
    client: OpenCodeClient,
    sessionID: string,
    runID: string,
    startedAt: number,
    signal: AbortSignal,
    useObserved = true,
  ): Promise<TerminalOutcome> {
    const messages = await this.messagesForRun(client, sessionID, runID, signal);
    const run = this.options.repository.run(runID);
    const admittedAt =
      runInputCreatedAt(messages, runID) ??
      (run?.rootSessionID && run.rootSessionID !== sessionID ? startedAt : null);
    const durable = await this.durableSessionOutcome(client, sessionID, runID, admittedAt, signal);
    if (durable !== "unknown") return durable;
    const persisted = persistedMessageOutcome(messages, runID, startedAt);
    return persisted === "unknown" && useObserved
      ? (this.sessionOutcomes.get(sessionID) ?? "unknown")
      : persisted;
  }

  private async durableSessionOutcome(
    client: OpenCodeClient,
    sessionID: string,
    runID: string,
    admittedAt: number | null,
    signal: AbortSignal,
  ): Promise<TerminalOutcome> {
    const run = this.options.repository.run(runID);
    const previousCursor = run?.sessionCursors[sessionID] ?? 0;
    let cursor = previousCursor;
    let outcome: TerminalOutcome = "unknown";
    try {
      for await (const event of client.session.log(
        {
          sessionID,
          ...(previousCursor ? { after: previousCursor } : {}),
          follow: false,
        },
        { signal: requestSignal(signal) },
      )) {
        if (event.type === "log.synced") {
          if (event.seq !== undefined) cursor = Math.max(cursor, event.seq);
          continue;
        }
        cursor = Math.max(cursor, event.durable.seq);
        if (admittedAt === null || event.created < admittedAt) continue;
        if (event.type === "session.execution.started") {
          this.options.repository.recordExecutionEvent(runID, "started", event.created);
        }
        if (
          event.type === "session.execution.succeeded" ||
          event.type === "session.execution.failed" ||
          event.type === "session.execution.interrupted"
        ) {
          outcome = terminalEventOutcome(event);
          this.options.repository.recordExecutionEvent(runID, "completed", event.created);
        }
      }
    } catch {
      return "unknown";
    }
    if (cursor !== previousCursor && run) {
      this.options.repository.patchRun(runID, {
        sessionCursorsJSON: JSON.stringify({ ...run.sessionCursors, [sessionID]: cursor }),
      });
    }
    return outcome;
  }

  private async captureSessionCursor(
    client: OpenCodeClient,
    sessionID: string,
    runID: string,
    signal: AbortSignal,
  ): Promise<void> {
    let cursor = 0;
    try {
      for await (const event of client.session.log(
        { sessionID, follow: false },
        { signal: requestSignal(signal) },
      )) {
        cursor = Math.max(
          cursor,
          event.type === "log.synced" ? (event.seq ?? 0) : event.durable.seq,
        );
      }
    } catch {
      // Persisting zero still records that the pre-admission cursor capture was attempted.
    }
    const run = this.options.repository.run(runID);
    if (!run || sessionID in run.sessionCursors) return;
    this.options.repository.patchRun(runID, {
      sessionCursorsJSON: JSON.stringify({ ...run.sessionCursors, [sessionID]: cursor }),
    });
  }

  private async messagesForRun(
    client: OpenCodeClient,
    sessionID: string,
    runID: string,
    signal: AbortSignal,
  ): Promise<SessionMessageInfo[]> {
    const messages: SessionMessageInfo[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    while (true) {
      const response = await client.message.list(
        cursor ? { sessionID, limit: 100, cursor } : { sessionID, limit: 100, order: "desc" },
        { signal: requestSignal(signal) },
      );
      messages.push(...response.data);
      if (runInputCreatedAt(response.data, runID) !== null) break;
      const next = response.cursor.next ?? undefined;
      if (!next || cursors.has(next)) break;
      cursors.add(next);
      cursor = next;
    }
    return messages.toSorted((left, right) => left.time.created - right.time.created);
  }

  private async resultSummary(
    client: OpenCodeClient,
    sessionID: string,
    runID: string,
    signal: AbortSignal,
  ): Promise<string> {
    const messages = await this.messagesForRun(client, sessionID, runID, signal);
    const message = runAssistantMessage(messages, runID);
    if (!message || message.type !== "assistant") return "Scheduled run completed.";
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!text) return "Scheduled run completed.";
    return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…` : text;
  }

  private finish(
    run: AutomationRun,
    definition: AutomationDefinition,
    state: AutomationRunState,
    error: { code: string; message: string } | null,
    summary: string | null = null,
  ): void {
    const finished = this.options.repository.finishRun(run.id, definition.id, {
      state,
      error,
      summary,
      attention: null,
      completedAt: Date.now(),
    });
    for (const [sessionID, runID] of this.sessionRuns) {
      if (runID !== run.id) continue;
      this.sessionRuns.delete(sessionID);
      this.sessionOutcomes.delete(sessionID);
    }
    this.memoryDirectories.delete(run.id);
    this.options.onChanged();
    if (finished) this.options.onFinished(finished, definition);
  }

  private setAttention(runID: string, attention: NonNullable<AutomationRun["attention"]>): void {
    const current = this.options.repository.run(runID);
    if (!current) return;
    const unchanged =
      current.state === "needs-attention" &&
      current.attention?.type === attention.type &&
      current.attention.sessionID === attention.sessionID &&
      current.attention.requestID === attention.requestID;
    const run = this.options.repository.patchRun(runID, {
      state: "needs-attention",
      attention,
    });
    this.options.onChanged();
    const definition = this.options.repository.runDefinition(runID);
    if (!unchanged && run && definition) this.options.onAttention(run, definition);
  }
}

function terminalEventOutcome(
  event: Extract<
    OpenCodeEvent,
    {
      type:
        | "session.execution.succeeded"
        | "session.execution.failed"
        | "session.execution.interrupted";
    }
  >,
): Exclude<TerminalOutcome, "unknown"> {
  if (event.type === "session.execution.succeeded") return "succeeded";
  if (event.type === "session.execution.interrupted") return "interrupted";
  return event.data.error.type === "MessageAbortedError" ? "interrupted" : "failed";
}

export function persistedMessageOutcome(
  messages: SessionMessageInfo[],
  runID: string,
  startedAt: number,
): TerminalOutcome {
  const runInputIndex = messages.findIndex(
    (message) =>
      message.type === "user" &&
      objectValue(message.metadata?.["palot.automation"])?.runID === runID,
  );
  if (runInputIndex < 0) return "unknown";
  const nextInputIndex = messages.findIndex(
    (message, index) => index > runInputIndex && message.type === "user",
  );
  const relevant = messages.slice(
    runInputIndex + 1,
    nextInputIndex >= 0 ? nextInputIndex : undefined,
  );
  const assistant = relevant.findLast(
    (message): message is SessionMessageAssistant =>
      message.type === "assistant" && message.time.created >= startedAt,
  );
  if (!assistant) return "unknown";
  if (assistant.error || assistant.finish === "error" || assistant.finish === "content-filter") {
    return "failed";
  }
  if (!assistant.time.completed) return "interrupted";
  return assistant.finish === "stop" ||
    assistant.finish === "length" ||
    assistant.finish === "tool-calls"
    ? "succeeded"
    : "unknown";
}

export function isAutomationMemoryPermission(resources: string[], directory: string): boolean {
  const expected = `${normalizePermissionPath(directory)}/*`;
  return (
    resources.length > 0 && resources.every((value) => normalizePermissionPath(value) === expected)
  );
}

function normalizePermissionPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

function runInputCreatedAt(messages: SessionMessageInfo[], runID: string): number | null {
  const input = messages.find(
    (message) =>
      message.type === "user" &&
      objectValue(message.metadata?.["palot.automation"])?.runID === runID,
  );
  return input?.time.created ?? null;
}

function runAssistantMessage(
  messages: SessionMessageInfo[],
  runID: string,
): SessionMessageAssistant | null {
  const runInputIndex = messages.findIndex(
    (message) =>
      message.type === "user" &&
      objectValue(message.metadata?.["palot.automation"])?.runID === runID,
  );
  if (runInputIndex < 0) return null;
  const nextInputIndex = messages.findIndex(
    (message, index) => index > runInputIndex && message.type === "user",
  );
  return (
    messages
      .slice(runInputIndex + 1, nextInputIndex >= 0 ? nextInputIndex : undefined)
      .findLast((message): message is SessionMessageAssistant => message.type === "assistant") ??
    null
  );
}

function requestSignal(parent: AbortSignal): AbortSignal {
  return AbortSignal.any([parent, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function automationSessionID(runID: string): string {
  return `ses_${runID.replaceAll("-", "").slice(0, 26)}`;
}

async function requireDirectory(directory: string): Promise<void> {
  try {
    await access(directory);
  } catch {
    throw new AutomationConfigurationError(`The configured directory is unavailable: ${directory}`);
  }
}
