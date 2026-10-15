import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import {
  PROJECT_SCRIPT_LIMITS,
  type ProjectScript,
  type ProjectScriptDraft,
  type ProjectScriptsTarget,
} from "../../shared/project-scripts-contract";
import * as schema from "../database/schema";

export class ProjectScriptError extends Error {}

/** Scripts keyed by connection profile and OpenCode project, in the order people added them. */
export class ProjectScriptRepository {
  constructor(
    private readonly database: NodeSQLiteDatabase,
    private readonly createID: () => string = randomUUID,
  ) {}

  list(target: ProjectScriptsTarget): ProjectScript[] {
    return this.database
      .select()
      .from(schema.projectScripts)
      .where(matches(target))
      .orderBy(asc(schema.projectScripts.position), asc(schema.projectScripts.createdAt))
      .all()
      .map(toScript);
  }

  /** Settle scripts for every project on a profile; cheap enough to skip OpenCode lookups. */
  hasSettleScripts(profileID: string): boolean {
    return (
      this.database
        .select({ id: schema.projectScripts.id })
        .from(schema.projectScripts)
        .where(
          and(
            eq(schema.projectScripts.profileID, profileID),
            eq(schema.projectScripts.runOnSettle, true),
          ),
        )
        .limit(1)
        .get() !== undefined
    );
  }

  save(target: ProjectScriptsTarget, draft: ProjectScriptDraft, at: number): ProjectScript[] {
    const script = normalizeDraft(draft);
    this.database.transaction(
      (tx) => {
        const existing = tx
          .select()
          .from(schema.projectScripts)
          .where(matches(target))
          .orderBy(asc(schema.projectScripts.position))
          .all();
        if (script.id) {
          const current = existing.find((candidate) => candidate.id === script.id);
          if (!current) throw new ProjectScriptError("That script no longer exists.");
          tx.update(schema.projectScripts)
            .set({
              name: script.name,
              command: script.command,
              runOnSettle: script.runOnSettle,
              timeoutSeconds: script.timeoutSeconds,
              updatedAt: at,
            })
            .where(eq(schema.projectScripts.id, current.id))
            .run();
          return;
        }
        if (existing.length >= PROJECT_SCRIPT_LIMITS.scriptsPerProject)
          throw new ProjectScriptError(
            `A project can have at most ${PROJECT_SCRIPT_LIMITS.scriptsPerProject} scripts.`,
          );
        tx.insert(schema.projectScripts)
          .values({
            id: this.createID(),
            profileID: target.profileID,
            projectID: target.projectID,
            name: script.name,
            command: script.command,
            runOnSettle: script.runOnSettle,
            timeoutSeconds: script.timeoutSeconds,
            position: (existing.at(-1)?.position ?? -1) + 1,
            createdAt: at,
            updatedAt: at,
          })
          .run();
      },
      { behavior: "immediate" },
    );
    return this.list(target);
  }

  remove(target: ProjectScriptsTarget, scriptID: string): ProjectScript[] {
    this.database
      .delete(schema.projectScripts)
      .where(and(matches(target), eq(schema.projectScripts.id, scriptID)))
      .run();
    return this.list(target);
  }
}

function matches(target: ProjectScriptsTarget) {
  return and(
    eq(schema.projectScripts.profileID, target.profileID),
    eq(schema.projectScripts.projectID, target.projectID),
  );
}

function toScript(record: typeof schema.projectScripts.$inferSelect): ProjectScript {
  return {
    id: record.id,
    name: record.name,
    command: record.command,
    runOnSettle: record.runOnSettle,
    timeoutSeconds: record.timeoutSeconds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeDraft(draft: ProjectScriptDraft): ProjectScriptDraft {
  const name = draft.name.trim();
  // Keep the command byte-for-byte apart from surrounding whitespace: settings show it exactly.
  const command = draft.command.trim();
  if (!name) throw new ProjectScriptError("Name the script.");
  if (!command) throw new ProjectScriptError("Enter a command.");
  if (name.length > PROJECT_SCRIPT_LIMITS.name)
    throw new ProjectScriptError(
      `Use at most ${PROJECT_SCRIPT_LIMITS.name} characters for the name.`,
    );
  if (command.length > PROJECT_SCRIPT_LIMITS.command)
    throw new ProjectScriptError(
      `Use at most ${PROJECT_SCRIPT_LIMITS.command} characters for the command.`,
    );
  if (
    !Number.isInteger(draft.timeoutSeconds) ||
    draft.timeoutSeconds < PROJECT_SCRIPT_LIMITS.minTimeoutSeconds ||
    draft.timeoutSeconds > PROJECT_SCRIPT_LIMITS.maxTimeoutSeconds
  )
    throw new ProjectScriptError(
      `Choose a timeout between ${PROJECT_SCRIPT_LIMITS.minTimeoutSeconds} and ${PROJECT_SCRIPT_LIMITS.maxTimeoutSeconds} seconds.`,
    );
  return { ...draft, name, command };
}
