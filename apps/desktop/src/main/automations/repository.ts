import { and, asc, desc, eq, inArray, isNull, lte, ne, notInArray } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import type {
  AutomationDefinition,
  AutomationRecord,
  AutomationRun,
  AutomationRunAttention,
  AutomationRunError,
  AutomationRunState,
  AutomationRunTrigger,
} from "../../shared";
import * as schema from "../database/schema";

const NONTERMINAL_STATES: AutomationRunState[] = [
  "pending",
  "preparing",
  "queued",
  "running",
  "needs-attention",
  "settling",
];

type Database = NodeSQLiteDatabase<typeof schema>;
type RunPatch = Partial<{
  state: AutomationRunState;
  rootSessionID: string | null;
  inboxID: string | null;
  worktreeDirectory: string | null;
  sessionCursorsJSON: string;
  attention: AutomationRunAttention | null;
  summary: string | null;
  error: AutomationRunError | null;
  startedAt: number | null;
  completedAt: number | null;
  executionStartedAt: number | null;
  executionCompletedAt: number | null;
  readAt: number | null;
  archivedAt: number | null;
}>;

export class AutomationRepository {
  constructor(private readonly database: Database) {}

  synchronizeDefinition(
    definition: AutomationDefinition,
    definitionVersion: number,
    nextRunAt: number | null,
  ): void {
    this.database
      .insert(schema.automations)
      .values({
        id: definition.id,
        profileID: definition.profileID,
        status: definition.status,
        definitionVersion,
        definitionJSON: JSON.stringify(definition),
        nextRunAt: definition.status === "active" ? nextRunAt : null,
        lastRunAt: null,
        lastEvaluatedAt: Date.now(),
        activeRunID: null,
        consecutiveStartFailures: 0,
        createdAt: definition.createdAt,
        updatedAt: definition.updatedAt,
        deletedAt: null,
      })
      .onConflictDoUpdate({
        target: schema.automations.id,
        set: {
          profileID: definition.profileID,
          status: definition.status,
          definitionVersion,
          definitionJSON: JSON.stringify(definition),
          nextRunAt: definition.status === "active" ? nextRunAt : null,
          lastEvaluatedAt: Date.now(),
          updatedAt: definition.updatedAt,
          deletedAt: null,
        },
      })
      .run();
  }

  load(profileID: string): { automations: AutomationRecord[]; runs: AutomationRun[] } {
    const automations = this.database
      .select()
      .from(schema.automations)
      .where(
        and(eq(schema.automations.profileID, profileID), ne(schema.automations.status, "deleted")),
      )
      .orderBy(asc(schema.automations.nextRunAt), asc(schema.automations.createdAt))
      .all()
      .map(mapAutomation);
    const runs = this.database
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.profileID, profileID))
      .orderBy(desc(schema.automationRuns.createdAt))
      .limit(500)
      .all()
      .map(mapRun);
    return { automations, runs };
  }

  automation(id: string): AutomationRecord | null {
    const record = this.database
      .select()
      .from(schema.automations)
      .where(and(eq(schema.automations.id, id), ne(schema.automations.status, "deleted")))
      .get();
    return record ? mapAutomation(record) : null;
  }

  setDefinitionState(input: {
    definition: AutomationDefinition;
    definitionVersion: number;
    nextRunAt: number | null;
  }): void {
    this.database
      .update(schema.automations)
      .set({
        status: input.definition.status,
        definitionVersion: input.definitionVersion,
        definitionJSON: JSON.stringify(input.definition),
        nextRunAt: input.definition.status === "active" ? input.nextRunAt : null,
        lastEvaluatedAt: Date.now(),
        updatedAt: input.definition.updatedAt,
      })
      .where(eq(schema.automations.id, input.definition.id))
      .run();
  }

  deleteDefinition(id: string, at: number): void {
    this.database
      .update(schema.automations)
      .set({ status: "deleted", nextRunAt: null, deletedAt: at, updatedAt: at })
      .where(eq(schema.automations.id, id))
      .run();
  }

  recordStartFailure(id: string): number {
    const current = this.database
      .select({ count: schema.automations.consecutiveStartFailures })
      .from(schema.automations)
      .where(eq(schema.automations.id, id))
      .get();
    const count = (current?.count ?? 0) + 1;
    this.database
      .update(schema.automations)
      .set({ consecutiveStartFailures: count, updatedAt: Date.now() })
      .where(eq(schema.automations.id, id))
      .run();
    return count;
  }

  resetStartFailures(id: string): void {
    this.database
      .update(schema.automations)
      .set({ consecutiveStartFailures: 0, updatedAt: Date.now() })
      .where(eq(schema.automations.id, id))
      .run();
  }

  reconcileDefinitionFiles(validIDs: string[], corruptIDs: string[], at: number): void {
    this.database.transaction((tx) => {
      if (corruptIDs.length) {
        tx.update(schema.automations)
          .set({ status: "paused", nextRunAt: null, updatedAt: at })
          .where(
            and(
              inArray(schema.automations.id, corruptIDs),
              ne(schema.automations.status, "deleted"),
            ),
          )
          .run();
      }
      const knownIDs = [...validIDs, ...corruptIDs];
      tx.update(schema.automations)
        .set({ status: "deleted", nextRunAt: null, deletedAt: at, updatedAt: at })
        .where(
          knownIDs.length
            ? and(
                ne(schema.automations.status, "deleted"),
                notInArray(schema.automations.id, knownIDs),
              )
            : ne(schema.automations.status, "deleted"),
        )
        .run();
    });
  }

  due(profileID: string, now: number, limit: number): AutomationRecord[] {
    return this.database
      .select()
      .from(schema.automations)
      .where(
        and(
          eq(schema.automations.status, "active"),
          eq(schema.automations.profileID, profileID),
          lte(schema.automations.nextRunAt, now),
          isNull(schema.automations.activeRunID),
        ),
      )
      .orderBy(asc(schema.automations.nextRunAt), asc(schema.automations.id))
      .limit(limit)
      .all()
      .map(mapAutomation);
  }

  createRun(input: {
    id: string;
    definition: AutomationDefinition;
    definitionVersion: number;
    trigger: AutomationRunTrigger;
    scheduledFor: number;
    occurrenceKey: string;
    nextRunAt?: number | null;
  }): AutomationRun | null {
    const now = Date.now();
    let created = false;
    this.database.transaction(
      (tx) => {
        const existing = tx
          .select({ id: schema.automationRuns.id })
          .from(schema.automationRuns)
          .where(eq(schema.automationRuns.occurrenceKey, input.occurrenceKey))
          .get();
        if (existing) return;
        const claim = tx
          .update(schema.automations)
          .set({
            activeRunID: input.id,
            lastRunAt: input.scheduledFor,
            ...(input.nextRunAt !== undefined ? { nextRunAt: input.nextRunAt } : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.automations.id, input.definition.id),
              isNull(schema.automations.activeRunID),
              ne(schema.automations.status, "deleted"),
            ),
          )
          .run();
        if (claim.changes === 0) return;
        tx.insert(schema.automationRuns)
          .values({
            id: input.id,
            automationID: input.definition.id,
            profileID: input.definition.profileID,
            definitionVersion: input.definitionVersion,
            definitionSnapshotJSON: JSON.stringify(input.definition),
            trigger: input.trigger,
            scheduledFor: input.scheduledFor,
            occurrenceKey: input.occurrenceKey,
            state: "pending",
            sessionCursorsJSON: "{}",
            createdAt: now,
            updatedAt: now,
          })
          .run();
        created = true;
      },
      { behavior: "immediate" },
    );
    return created ? this.run(input.id) : null;
  }

  run(id: string): AutomationRun | null {
    const value = this.database
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.id, id))
      .get();
    return value ? mapRun(value) : null;
  }

  previousRun(automationID: string, runID: string): AutomationRun | null {
    const value = this.database
      .select()
      .from(schema.automationRuns)
      .where(
        and(
          eq(schema.automationRuns.automationID, automationID),
          ne(schema.automationRuns.id, runID),
        ),
      )
      .orderBy(desc(schema.automationRuns.createdAt))
      .limit(1)
      .get();
    return value ? mapRun(value) : null;
  }

  runDefinition(id: string): AutomationDefinition | null {
    const value = this.database
      .select({ definition: schema.automationRuns.definitionSnapshotJSON })
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.id, id))
      .get();
    return value ? (JSON.parse(value.definition) as AutomationDefinition) : null;
  }

  activeRuns(profileID?: string): AutomationRun[] {
    return this.database
      .select()
      .from(schema.automationRuns)
      .where(
        profileID
          ? and(
              eq(schema.automationRuns.profileID, profileID),
              inArray(schema.automationRuns.state, NONTERMINAL_STATES),
            )
          : inArray(schema.automationRuns.state, NONTERMINAL_STATES),
      )
      .orderBy(asc(schema.automationRuns.createdAt))
      .all()
      .map(mapRun);
  }

  runsForSession(sessionID: string): AutomationRun[] {
    return this.database
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.rootSessionID, sessionID))
      .orderBy(desc(schema.automationRuns.createdAt))
      .all()
      .map(mapRun);
  }

  patchRun(id: string, patch: RunPatch): AutomationRun | null {
    const now = Date.now();
    this.database
      .update(schema.automationRuns)
      .set({
        ...(patch.state !== undefined ? { state: patch.state } : {}),
        ...(patch.rootSessionID !== undefined ? { rootSessionID: patch.rootSessionID } : {}),
        ...(patch.inboxID !== undefined ? { inboxID: patch.inboxID } : {}),
        ...(patch.worktreeDirectory !== undefined
          ? { worktreeDirectory: patch.worktreeDirectory }
          : {}),
        ...(patch.sessionCursorsJSON !== undefined
          ? { sessionCursorsJSON: patch.sessionCursorsJSON }
          : {}),
        ...(patch.attention !== undefined
          ? { attentionJSON: patch.attention ? JSON.stringify(patch.attention) : null }
          : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.error !== undefined
          ? {
              errorCode: patch.error?.code ?? null,
              errorMessage: patch.error?.message ?? null,
            }
          : {}),
        ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        ...(patch.executionStartedAt !== undefined
          ? { executionStartedAt: patch.executionStartedAt }
          : {}),
        ...(patch.executionCompletedAt !== undefined
          ? { executionCompletedAt: patch.executionCompletedAt }
          : {}),
        ...(patch.readAt !== undefined ? { readAt: patch.readAt } : {}),
        ...(patch.archivedAt !== undefined ? { archivedAt: patch.archivedAt } : {}),
        updatedAt: now,
      })
      .where(eq(schema.automationRuns.id, id))
      .run();
    return this.run(id);
  }

  recordExecutionEvent(
    runID: string,
    kind: "started" | "completed",
    at: number,
  ): AutomationRun | null {
    const current = this.run(runID);
    if (!current) return null;
    if (kind === "started") {
      return this.patchRun(runID, {
        executionStartedAt:
          current.executionStartedAt === null ? at : Math.min(current.executionStartedAt, at),
      });
    }
    return this.patchRun(runID, {
      executionCompletedAt:
        current.executionCompletedAt === null ? at : Math.max(current.executionCompletedAt, at),
    });
  }

  finishRun(
    runID: string,
    automationID: string,
    patch: RunPatch & { state: AutomationRunState },
  ): AutomationRun | null {
    const value = this.patchRun(runID, patch);
    this.database
      .update(schema.automations)
      .set({ activeRunID: null, updatedAt: Date.now() })
      .where(
        and(eq(schema.automations.id, automationID), eq(schema.automations.activeRunID, runID)),
      )
      .run();
    return value;
  }

  markAllRead(profileID: string, at: number): void {
    this.database
      .update(schema.automationRuns)
      .set({ readAt: at, updatedAt: at })
      .where(
        and(eq(schema.automationRuns.profileID, profileID), isNull(schema.automationRuns.readAt)),
      )
      .run();
  }
}

function mapAutomation(value: typeof schema.automations.$inferSelect): AutomationRecord {
  const definition = JSON.parse(value.definitionJSON) as AutomationDefinition;
  return {
    ...definition,
    status: value.status === "deleted" ? definition.status : value.status,
    definitionVersion: value.definitionVersion,
    nextRunAt: value.nextRunAt,
    lastRunAt: value.lastRunAt,
    activeRunID: value.activeRunID,
    consecutiveStartFailures: value.consecutiveStartFailures,
  };
}

function mapRun(value: typeof schema.automationRuns.$inferSelect): AutomationRun {
  return {
    id: value.id,
    automationID: value.automationID,
    profileID: value.profileID,
    definitionVersion: value.definitionVersion,
    trigger: value.trigger,
    scheduledFor: value.scheduledFor,
    state: value.state,
    rootSessionID: value.rootSessionID,
    inboxID: value.inboxID,
    worktreeDirectory: value.worktreeDirectory,
    sessionCursors: parseSessionCursors(value.sessionCursorsJSON),
    attention: value.attentionJSON
      ? (JSON.parse(value.attentionJSON) as AutomationRunAttention)
      : null,
    summary: value.summary,
    error:
      value.errorCode && value.errorMessage
        ? { code: value.errorCode, message: value.errorMessage }
        : null,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    executionStartedAt: value.executionStartedAt,
    executionCompletedAt: value.executionCompletedAt,
    readAt: value.readAt,
    archivedAt: value.archivedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseSessionCursors(value: string): Record<string, number> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => Number.isSafeInteger(entry[1]) && entry[1] >= 0,
      ),
    );
  } catch {
    return {};
  }
}
