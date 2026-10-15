import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import type {
  ActivityWatermark,
  SessionSettleBatchTrigger,
  SessionTriageCommand,
  SessionTriageSnapshot,
} from "../shared/session-triage-contract";
import * as schema from "./database/schema";
import { palotDatabase } from "./database/client";

/** A task newly settled, or settled again through newer activity. */
export interface SessionSettledEvent {
  profileID: string;
  sessionID: string;
  through: ActivityWatermark;
  /** Set when one command settled several tasks at once (Inbox menu or inactivity sweep). */
  batch: { id: string; trigger: SessionSettleBatchTrigger } | null;
}

type SettledListener = (event: SessionSettledEvent) => void;
const settledListeners = new Set<SettledListener>();

/**
 * Observe settlements from every source (row actions, batches, PR merges). Replayed commands that
 * leave the stored settlement unchanged do not notify.
 */
export function onSessionSettled(listener: SettledListener): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

function notifySessionSettled(event: SessionSettledEvent): void {
  for (const listener of settledListeners) {
    try {
      listener(event);
    } catch {
      // A failing observer never undoes or blocks the stored triage change.
    }
  }
}

export class SessionTriageStore {
  constructor(
    private readonly database: NodeSQLiteDatabase,
    private readonly onSettled: SettledListener = notifySessionSettled,
  ) {}

  load(profileID: string): SessionTriageSnapshot {
    const profile = this.database
      .select()
      .from(schema.triageProfiles)
      .where(eq(schema.triageProfiles.profileID, profileID))
      .get();
    const sessions = this.database
      .select()
      .from(schema.sessionTriage)
      .where(eq(schema.sessionTriage.profileID, profileID))
      .all()
      .map((record) => ({
        sessionID: record.sessionID,
        disposition: record.disposition,
        settledThrough:
          record.settledUpdatedAt !== null && record.settledSessionID !== null
            ? { updatedAt: record.settledUpdatedAt, sessionID: record.settledSessionID }
            : null,
        pinnedAt: record.pinnedAt,
        snoozedUntil: record.snoozedUntil,
        snoozedThrough:
          record.snoozedUpdatedAt !== null && record.snoozedSessionID !== null
            ? { updatedAt: record.snoozedUpdatedAt, sessionID: record.snoozedSessionID }
            : null,
        updatedAt: record.updatedAt,
      }));
    return {
      profileID,
      bootstrapThrough:
        profile && profile.bootstrapUpdatedAt !== null && profile.bootstrapSessionID !== null
          ? { updatedAt: profile.bootstrapUpdatedAt, sessionID: profile.bootstrapSessionID }
          : null,
      sessions,
    };
  }

  dispatch(command: SessionTriageCommand): SessionTriageSnapshot {
    const now = command.type === "remove" ? Date.now() : command.at;
    // Collected inside the transaction and announced only after it commits.
    const settled: SessionSettledEvent[] = [];
    this.database.transaction(
      (tx) => {
        if (command.type === "bootstrap") {
          const current = tx
            .select()
            .from(schema.triageProfiles)
            .where(eq(schema.triageProfiles.profileID, command.profileID))
            .get();
          if (!current) {
            tx.insert(schema.triageProfiles)
              .values({
                profileID: command.profileID,
                bootstrapUpdatedAt: command.through.updatedAt,
                bootstrapSessionID: command.through.sessionID,
                createdAt: command.at,
                updatedAt: command.at,
              })
              .run();
          } else if (current.bootstrapUpdatedAt === null || current.bootstrapSessionID === null) {
            tx.update(schema.triageProfiles)
              .set({
                bootstrapUpdatedAt: command.through.updatedAt,
                bootstrapSessionID: command.through.sessionID,
                updatedAt: command.at,
              })
              .where(eq(schema.triageProfiles.profileID, command.profileID))
              .run();
          }
          return;
        }
        tx.insert(schema.triageProfiles)
          .values({
            profileID: command.profileID,
            bootstrapUpdatedAt: null,
            bootstrapSessionID: null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: schema.triageProfiles.profileID,
            set: { updatedAt: now },
          })
          .run();

        if (command.type === "remove") {
          tx.delete(schema.sessionTriage)
            .where(
              and(
                eq(schema.sessionTriage.profileID, command.profileID),
                eq(schema.sessionTriage.sessionID, command.sessionID),
              ),
            )
            .run();
          return;
        }
        if (command.type === "settle-many") {
          const batch = { id: randomUUID(), trigger: command.trigger };
          for (const entry of command.sessions) {
            const event = applySessionCommand(tx, {
              type: "settle",
              profileID: command.profileID,
              sessionID: entry.sessionID,
              at: command.at,
              through: entry.through,
            });
            if (event) settled.push({ ...event, batch });
          }
          return;
        }
        if (command.type === "inbox-many") {
          for (const sessionID of command.sessionIDs) {
            applySessionCommand(tx, {
              type: "inbox",
              profileID: command.profileID,
              sessionID,
              at: command.at,
            });
          }
          return;
        }
        const event = applySessionCommand(tx, command);
        if (event) settled.push(event);
      },
      { behavior: "immediate" },
    );
    // After the commit, so observers never act on a rolled-back settlement.
    for (const event of settled) this.onSettled(event);
    return this.load(command.profileID);
  }
}

type Transaction = Parameters<Parameters<NodeSQLiteDatabase["transaction"]>[0]>[0];
type SessionCommand = Exclude<
  SessionTriageCommand,
  { type: "bootstrap" | "remove" | "settle-many" | "inbox-many" }
>;

/** Apply one task's command; returns the settlement it newly recorded, if any. */
function applySessionCommand(tx: Transaction, command: SessionCommand): SessionSettledEvent | null {
  const current = tx
    .select()
    .from(schema.sessionTriage)
    .where(
      and(
        eq(schema.sessionTriage.profileID, command.profileID),
        eq(schema.sessionTriage.sessionID, command.sessionID),
      ),
    )
    .get();
  const profile = tx
    .select()
    .from(schema.triageProfiles)
    .where(eq(schema.triageProfiles.profileID, command.profileID))
    .get();
  if (command.type === "inbox" && command.activity) {
    const through =
      current &&
      current.snoozedUntil !== null &&
      current.snoozedUpdatedAt !== null &&
      current.snoozedSessionID !== null
        ? {
            updatedAt: current.snoozedUpdatedAt,
            sessionID: current.snoozedSessionID,
          }
        : current?.disposition === "settled" &&
            current.settledUpdatedAt !== null &&
            current.settledSessionID !== null
          ? {
              updatedAt: current.settledUpdatedAt,
              sessionID: current.settledSessionID,
            }
          : !current?.disposition &&
              profile &&
              profile?.bootstrapUpdatedAt !== null &&
              profile?.bootstrapSessionID !== null
            ? {
                updatedAt: profile.bootstrapUpdatedAt,
                sessionID: profile.bootstrapSessionID,
              }
            : null;
    if (through && watermarkCovers(through, command.activity)) return null;
  }
  const next = transition(current, command);
  if (next === current) return null;
  tx.insert(schema.sessionTriage)
    .values({ profileID: command.profileID, sessionID: command.sessionID, ...next })
    .onConflictDoUpdate({
      target: [schema.sessionTriage.profileID, schema.sessionTriage.sessionID],
      set: next,
    })
    .run();
  if (
    next.disposition === "settled" &&
    next.settledUpdatedAt !== null &&
    next.settledSessionID !== null &&
    (current?.disposition !== "settled" ||
      current.settledUpdatedAt !== next.settledUpdatedAt ||
      current.settledSessionID !== next.settledSessionID)
  ) {
    return {
      profileID: command.profileID,
      sessionID: command.sessionID,
      through: { updatedAt: next.settledUpdatedAt, sessionID: next.settledSessionID },
      batch: null,
    };
  }
  return null;
}

let store: SessionTriageStore | null = null;

export function sessionTriageStore(): SessionTriageStore {
  return (store ??= new SessionTriageStore(palotDatabase()));
}

function watermarkCovers(through: ActivityWatermark, activity: ActivityWatermark): boolean {
  return (
    activity.updatedAt < through.updatedAt ||
    (activity.updatedAt === through.updatedAt && activity.sessionID <= through.sessionID)
  );
}

type StoredRecord = typeof schema.sessionTriage.$inferSelect;
type MutableRecord = Omit<StoredRecord, "profileID" | "sessionID">;

function transition(current: StoredRecord | undefined, command: SessionCommand): MutableRecord {
  if (current && command.at < current.updatedAt) return current;
  const base: MutableRecord = current
    ? {
        disposition: current.disposition,
        settledUpdatedAt: current.settledUpdatedAt,
        settledSessionID: current.settledSessionID,
        pinnedAt: current.pinnedAt,
        snoozedUntil: current.snoozedUntil,
        snoozedUpdatedAt: current.snoozedUpdatedAt,
        snoozedSessionID: current.snoozedSessionID,
        updatedAt: command.at,
      }
    : {
        disposition: null,
        settledUpdatedAt: null,
        settledSessionID: null,
        pinnedAt: null,
        snoozedUntil: null,
        snoozedUpdatedAt: null,
        snoozedSessionID: null,
        updatedAt: command.at,
      };

  if (command.type === "settle") {
    const through = latestWatermark(
      current && current.settledUpdatedAt !== null && current.settledSessionID !== null
        ? {
            updatedAt: current.settledUpdatedAt,
            sessionID: current.settledSessionID,
          }
        : null,
      command.through,
    );
    return {
      ...base,
      disposition: "settled",
      settledUpdatedAt: through.updatedAt,
      settledSessionID: through.sessionID,
      pinnedAt: null,
      snoozedUntil: null,
      snoozedUpdatedAt: null,
      snoozedSessionID: null,
    };
  }
  if (command.type === "inbox") {
    return {
      ...base,
      disposition: "inbox",
      settledUpdatedAt: null,
      settledSessionID: null,
      snoozedUntil: null,
      snoozedUpdatedAt: null,
      snoozedSessionID: null,
    };
  }
  if (command.type === "pin") {
    return {
      ...base,
      disposition: "inbox",
      settledUpdatedAt: null,
      settledSessionID: null,
      pinnedAt: command.at,
      snoozedUntil: null,
      snoozedUpdatedAt: null,
      snoozedSessionID: null,
    };
  }
  if (command.type === "unpin") return { ...base, pinnedAt: null };
  if (command.type === "snooze") {
    const through = latestWatermark(
      current && current.snoozedUpdatedAt !== null && current.snoozedSessionID !== null
        ? {
            updatedAt: current.snoozedUpdatedAt,
            sessionID: current.snoozedSessionID,
          }
        : null,
      command.through,
    );
    return {
      ...base,
      snoozedUntil: command.until,
      snoozedUpdatedAt: through.updatedAt,
      snoozedSessionID: through.sessionID,
    };
  }
  return { ...base, snoozedUntil: null, snoozedUpdatedAt: null, snoozedSessionID: null };
}

function latestWatermark(
  current: ActivityWatermark | null,
  candidate: ActivityWatermark,
): ActivityWatermark {
  return current && watermarkCovers(current, candidate) ? current : candidate;
}
