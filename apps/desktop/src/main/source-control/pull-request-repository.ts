import { and, eq } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import type {
  PullRequestLink,
  PullRequestSnapshot,
  PullRequestWatchEndReason,
} from "../../shared/source-control-contract";
import { pullRequestKey } from "../../shared/source-control-contract";
import * as schema from "../database/schema";
import type { PullRequestWatchState } from "./pull-request-watch";

type Row = typeof schema.pullRequestLinks.$inferSelect;

export interface StoredPullRequestLink {
  profileID: string;
  sessionID: string;
  key: string;
  source: "url" | "branch";
  snapshot: PullRequestSnapshot;
  linkedAt: number;
  syncedAt: number | null;
  syncError: string | null;
  settleCheckedAt: number | null;
  settledAt: number | null;
  watch: PullRequestWatchState | null;
  watchEnded: { reason: PullRequestWatchEndReason; at: number } | null;
}

export interface LinkIdentity {
  profileID: string;
  sessionID: string;
  key: string;
}

/** Persists task ↔ pull request links with their last known GitHub state and watch progress. */
export class PullRequestRepository {
  constructor(private readonly database: NodeSQLiteDatabase) {}

  list(filter: { profileID?: string; sessionID?: string } = {}): StoredPullRequestLink[] {
    const conditions = [
      ...(filter.profileID ? [eq(schema.pullRequestLinks.profileID, filter.profileID)] : []),
      ...(filter.sessionID ? [eq(schema.pullRequestLinks.sessionID, filter.sessionID)] : []),
    ];
    return this.database
      .select()
      .from(schema.pullRequestLinks)
      .where(conditions.length ? and(...conditions) : undefined)
      .all()
      .map(fromRow)
      .sort((left, right) => left.linkedAt - right.linkedAt || left.key.localeCompare(right.key));
  }

  get(identity: LinkIdentity): StoredPullRequestLink | null {
    const row = this.database.select().from(schema.pullRequestLinks).where(where(identity)).get();
    return row ? fromRow(row) : null;
  }

  /** Inserts a link, or refreshes the snapshot of an existing one without touching its watch. */
  upsert(input: {
    profileID: string;
    sessionID: string;
    source: "url" | "branch";
    snapshot: PullRequestSnapshot;
    at: number;
  }): StoredPullRequestLink {
    const key = pullRequestKey(input.snapshot);
    const values = {
      ...snapshotColumns(input.snapshot),
      syncedAt: input.at,
      syncError: null,
      updatedAt: input.at,
    };
    this.database
      .insert(schema.pullRequestLinks)
      .values({
        profileID: input.profileID,
        sessionID: input.sessionID,
        pullRequestKey: key,
        source: input.source,
        linkedAt: input.at,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          schema.pullRequestLinks.profileID,
          schema.pullRequestLinks.sessionID,
          schema.pullRequestLinks.pullRequestKey,
        ],
        set: values,
      })
      .run();
    return this.get({ profileID: input.profileID, sessionID: input.sessionID, key })!;
  }

  remove(identity: LinkIdentity): boolean {
    return this.database.delete(schema.pullRequestLinks).where(where(identity)).run().changes > 0;
  }

  /** Records a successful read. A reopened PR clears its settle check. */
  recordSnapshot(identity: LinkIdentity, snapshot: PullRequestSnapshot, at: number): void {
    const current = this.get(identity);
    if (!current) return;
    const reopened =
      (snapshot.state === "open" || snapshot.state === "draft") &&
      (current.snapshot.state === "merged" || current.snapshot.state === "closed");
    this.database
      .update(schema.pullRequestLinks)
      .set({
        ...snapshotColumns(snapshot),
        syncedAt: at,
        syncError: null,
        ...(reopened ? { settleCheckedAt: null } : {}),
        updatedAt: at,
      })
      .where(where(identity))
      .run();
  }

  recordSyncError(identity: LinkIdentity, message: string, at: number): void {
    this.database
      .update(schema.pullRequestLinks)
      .set({ syncError: message.slice(0, 500), updatedAt: at })
      .where(where(identity))
      .run();
  }

  recordSettle(identity: LinkIdentity, settled: boolean, at: number): void {
    this.database
      .update(schema.pullRequestLinks)
      .set({ settleCheckedAt: at, ...(settled ? { settledAt: at } : {}), updatedAt: at })
      .where(where(identity))
      .run();
  }

  startWatch(identity: LinkIdentity, watch: PullRequestWatchState, at: number): void {
    this.database
      .update(schema.pullRequestLinks)
      .set({
        watchJSON: JSON.stringify(watch),
        watchEndedReason: null,
        watchEndedAt: null,
        updatedAt: at,
      })
      .where(where(identity))
      .run();
  }

  /** The link's current watch when it is still the watch `expected` names. */
  currentWatch(
    identity: LinkIdentity,
    expected: WatchIdentity,
  ): { link: StoredPullRequestLink; watch: PullRequestWatchState } | null {
    const link = this.get(identity);
    return link?.watch && sameWatch(link.watch, expected) ? { link, watch: link.watch } : null;
  }

  /**
   * Saves watch progress only while the same watch is still on, so a stop or restart that
   * lands during a GitHub read wins.
   */
  updateWatch(identity: LinkIdentity, watch: PullRequestWatchState, at: number): boolean {
    if (!this.currentWatch(identity, watch)) return false;
    this.database
      .update(schema.pullRequestLinks)
      .set({ watchJSON: JSON.stringify(watch), updatedAt: at })
      .where(where(identity))
      .run();
    return true;
  }

  endWatch(
    identity: LinkIdentity,
    reason: PullRequestWatchEndReason,
    at: number,
    expected?: WatchIdentity,
  ): boolean {
    const current = this.get(identity);
    if (!current?.watch) return false;
    if (expected && !sameWatch(current.watch, expected)) return false;
    this.database
      .update(schema.pullRequestLinks)
      .set({ watchJSON: null, watchEndedReason: reason, watchEndedAt: at, updatedAt: at })
      .where(where(identity))
      .run();
    return true;
  }
}

export type WatchIdentity = Pick<PullRequestWatchState, "id" | "startedAt">;

export function sameWatch(left: WatchIdentity, right: WatchIdentity): boolean {
  return left.id === right.id && left.startedAt === right.startedAt;
}

export function toPullRequestLink(stored: StoredPullRequestLink): PullRequestLink {
  return {
    profileID: stored.profileID,
    sessionID: stored.sessionID,
    key: stored.key,
    pullRequest: stored.snapshot,
    source: stored.source,
    linkedAt: stored.linkedAt,
    syncedAt: stored.syncedAt,
    syncError: stored.syncError,
    watch: stored.watch
      ? {
          startedAt: stored.watch.startedAt,
          commentWakes: stored.watch.commentWakes,
          readFailures: stored.watch.readFailures,
          lastWakeAt: stored.watch.lastWakeAt,
        }
      : null,
    watchEnded: stored.watchEnded,
    settledAt: stored.settledAt,
  };
}

function where(identity: LinkIdentity) {
  return and(
    eq(schema.pullRequestLinks.profileID, identity.profileID),
    eq(schema.pullRequestLinks.sessionID, identity.sessionID),
    eq(schema.pullRequestLinks.pullRequestKey, identity.key),
  );
}

function snapshotColumns(snapshot: PullRequestSnapshot) {
  return {
    host: snapshot.host,
    repository: snapshot.repository,
    number: snapshot.number,
    url: snapshot.url,
    title: snapshot.title,
    state: snapshot.state,
    checks: snapshot.checks,
    reviewDecision: snapshot.reviewDecision,
    mergeable: snapshot.mergeable,
    headBranch: snapshot.headBranch,
    baseBranch: snapshot.baseBranch,
    author: snapshot.author,
    pullRequestUpdatedAt: snapshot.updatedAt,
    mergedAt: snapshot.mergedAt,
    closedAt: snapshot.closedAt,
  };
}

function fromRow(row: Row): StoredPullRequestLink {
  return {
    profileID: row.profileID,
    sessionID: row.sessionID,
    key: row.pullRequestKey,
    source: row.source,
    snapshot: {
      host: row.host,
      repository: row.repository,
      number: row.number,
      title: row.title,
      url: row.url,
      state: row.state,
      checks: row.checks,
      reviewDecision: row.reviewDecision,
      mergeable: row.mergeable,
      headBranch: row.headBranch,
      baseBranch: row.baseBranch,
      author: row.author,
      updatedAt: row.pullRequestUpdatedAt,
      mergedAt: row.mergedAt,
      closedAt: row.closedAt,
    },
    linkedAt: row.linkedAt,
    syncedAt: row.syncedAt,
    syncError: row.syncError,
    settleCheckedAt: row.settleCheckedAt,
    settledAt: row.settledAt,
    watch: parseWatch(row.watchJSON),
    watchEnded:
      row.watchEndedReason && row.watchEndedAt !== null
        ? { reason: row.watchEndedReason, at: row.watchEndedAt }
        : null,
  };
}

function parseWatch(value: string | null): PullRequestWatchState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as PullRequestWatchState;
    return typeof parsed?.startedAt === "number" ? parsed : null;
  } catch {
    return null;
  }
}
