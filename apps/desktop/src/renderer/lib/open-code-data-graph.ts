import {
  BasicIndex,
  createCollection,
  deepEquals,
  type BaseIndex,
  type Collection,
  type SyncConfig,
} from "@tanstack/db";
import type { Project, SessionInfo } from "@opencode/client";
import type { PalotMessage, SessionRequestSnapshot } from "../../shared";
import type { SessionExecutionState, SessionRuntimeStatus } from "../atoms/workspace";

export type OpenCodeDataGraphRecordKind =
  | "project"
  | "session"
  | "session-runtime"
  | "session-request"
  | "session-message";

interface OpenCodeDataGraphRecordBase<TKind extends OpenCodeDataGraphRecordKind, TValue> {
  connectionID: string;
  kind: TKind;
  entityID: string;
  sessionID: string | null;
  value: TValue;
}

export type OpenCodeProjectRecord = OpenCodeDataGraphRecordBase<"project", Project> & {
  sessionID: null;
};

export type OpenCodeSessionRecord = OpenCodeDataGraphRecordBase<"session", SessionInfo> & {
  sessionID: string;
};

export interface OpenCodeSessionRuntime {
  active: boolean;
  execution: SessionExecutionState | null;
  status: SessionRuntimeStatus | null;
}

export type OpenCodeSessionRuntimeRecord = OpenCodeDataGraphRecordBase<
  "session-runtime",
  OpenCodeSessionRuntime
> & {
  sessionID: string;
};

export type OpenCodeSessionRequestRecord = OpenCodeDataGraphRecordBase<
  "session-request",
  SessionRequestSnapshot
> & {
  sessionID: string;
};

export type OpenCodeSessionMessageRecord = OpenCodeDataGraphRecordBase<
  "session-message",
  PalotMessage
> & {
  sessionID: string;
};

export type OpenCodeDataGraphRecord =
  | OpenCodeProjectRecord
  | OpenCodeSessionRecord
  | OpenCodeSessionRuntimeRecord
  | OpenCodeSessionRequestRecord
  | OpenCodeSessionMessageRecord;

declare const openCodeDataGraphKeyBrand: unique symbol;
export type OpenCodeDataGraphKey = string & {
  readonly [openCodeDataGraphKeyBrand]: true;
};

export function openCodeDataGraphKey(
  connectionID: string,
  kind: OpenCodeDataGraphRecordKind,
  entityID: string,
  sessionID: string | null,
): OpenCodeDataGraphKey {
  return JSON.stringify([connectionID, kind, entityID, sessionID]) as OpenCodeDataGraphKey;
}

export function openCodeDataGraphRecordKey(record: OpenCodeDataGraphRecord): OpenCodeDataGraphKey {
  return openCodeDataGraphKey(record.connectionID, record.kind, record.entityID, record.sessionID);
}

export const openCodeDataGraphKeys = {
  project: (connectionID: string, projectID: string) =>
    openCodeDataGraphKey(connectionID, "project", projectID, null),
  session: (connectionID: string, sessionID: string) =>
    openCodeDataGraphKey(connectionID, "session", sessionID, sessionID),
  sessionRuntime: (connectionID: string, sessionID: string) =>
    openCodeDataGraphKey(connectionID, "session-runtime", sessionID, sessionID),
  sessionRequest: (connectionID: string, sessionID: string) =>
    openCodeDataGraphKey(connectionID, "session-request", sessionID, sessionID),
  sessionMessage: (connectionID: string, sessionID: string, messageID: string) =>
    openCodeDataGraphKey(connectionID, "session-message", messageID, sessionID),
} as const;

export type OpenCodeDataGraphCollection = Collection<OpenCodeDataGraphRecord, OpenCodeDataGraphKey>;

export interface OpenCodeDataGraphWriter {
  upsert(record: OpenCodeDataGraphRecord): void;
  delete(key: OpenCodeDataGraphKey): void;
  deleteWhere(predicate: (record: OpenCodeDataGraphRecord) => boolean): void;
}

export type OpenCodeDataGraphMutation =
  | { type: "upsert"; record: OpenCodeDataGraphRecord }
  | { type: "delete"; key: OpenCodeDataGraphKey }
  | {
      type: "deleteWhere";
      predicate: (record: OpenCodeDataGraphRecord) => boolean;
    };

export type OpenCodeDataGraphCommit =
  | readonly OpenCodeDataGraphMutation[]
  | ((writer: OpenCodeDataGraphWriter) => void);

type SyncParameters = Parameters<
  SyncConfig<OpenCodeDataGraphRecord, OpenCodeDataGraphKey>["sync"]
>[0];

let graphID = 0;

export function selectConnectionRecords(
  connectionID: string,
  graph: OpenCodeDataGraph = openCodeDataGraph,
): OpenCodeDataGraphRecord[] {
  return graph.selectConnectionRecords(connectionID);
}

export function selectSessionRecords(
  connectionID: string,
  sessionID: string,
  graph: OpenCodeDataGraph = openCodeDataGraph,
): Array<Exclude<OpenCodeDataGraphRecord, OpenCodeProjectRecord>> {
  return graph.selectSessionRecords(connectionID, sessionID);
}

export class OpenCodeDataGraph {
  readonly collection: OpenCodeDataGraphCollection;

  readonly #begin: SyncParameters["begin"];
  readonly #write: SyncParameters["write"];
  readonly #commitSync: SyncParameters["commit"];
  readonly #byConnection: BaseIndex<OpenCodeDataGraphKey>;
  readonly #bySession: BaseIndex<OpenCodeDataGraphKey>;
  readonly #byKind: BaseIndex<OpenCodeDataGraphKey>;
  #committing = false;

  constructor(id = `open-code-data-graph-${++graphID}`) {
    const syncCallbacks: Partial<Pick<SyncParameters, "begin" | "write" | "commit">> = {};

    this.collection = createCollection<OpenCodeDataGraphRecord, OpenCodeDataGraphKey>({
      id,
      getKey: openCodeDataGraphRecordKey,
      gcTime: Number.POSITIVE_INFINITY,
      startSync: true,
      sync: {
        rowUpdateMode: "full",
        sync: (parameters) => {
          syncCallbacks.begin = parameters.begin;
          syncCallbacks.write = parameters.write;
          syncCallbacks.commit = parameters.commit;
          parameters.markReady();
        },
      },
    });

    if (!syncCallbacks.begin || !syncCallbacks.write || !syncCallbacks.commit) {
      throw new Error("OpenCode data graph sync failed to start");
    }
    this.#begin = syncCallbacks.begin;
    this.#write = syncCallbacks.write;
    this.#commitSync = syncCallbacks.commit;
    // Create while empty, not during the first read. TanStack maintains these
    // indexes atomically before notifying collection subscribers; no second store.
    this.#byConnection = this.collection.createIndex((record) => record.connectionID, {
      indexType: BasicIndex,
    });
    this.#bySession = this.collection.createIndex((record) => record.sessionID, {
      indexType: BasicIndex,
    });
    this.#byKind = this.collection.createIndex((record) => record.kind, { indexType: BasicIndex });
  }

  commit(input: OpenCodeDataGraphCommit): boolean {
    if (this.#committing) throw new Error("OpenCode data graph commits cannot be nested");

    this.#committing = true;
    try {
      // Stage only touched keys. Nothing reaches sync until the callback succeeds.
      const pending = new Map<OpenCodeDataGraphKey, OpenCodeDataGraphRecord | undefined>();
      const deletedKeys = new Set<OpenCodeDataGraphKey>();

      const writer: OpenCodeDataGraphWriter = {
        upsert: (record) => {
          const key = openCodeDataGraphRecordKey(record);
          // A delete followed by an upsert moves the key to the staged tail,
          // matching Map iteration order for subsequent deleteWhere calls.
          if (pending.has(key) && pending.get(key) === undefined) pending.delete(key);
          pending.set(key, record);
        },
        delete: (key) => {
          pending.set(key, undefined);
          deletedKeys.add(key);
        },
        deleteWhere: (predicate) => {
          for (const [key, original] of this.collection) {
            if (deletedKeys.has(key)) continue;
            const record = pending.has(key) ? pending.get(key) : original;
            if (record && predicate(record)) writer.delete(key);
          }
          for (const [key, record] of pending) {
            if (record && (deletedKeys.has(key) || !this.collection.has(key))) {
              if (predicate(record)) writer.delete(key);
            }
          }
        },
      };

      if (typeof input === "function") {
        input(writer);
      } else {
        for (const mutation of input) {
          if (mutation.type === "upsert") writer.upsert(mutation.record);
          else if (mutation.type === "delete") writer.delete(mutation.key);
          else writer.deleteWhere(mutation.predicate);
        }
      }

      const deleted: OpenCodeDataGraphKey[] = [];
      const upserted: Array<{ type: "insert" | "update"; value: OpenCodeDataGraphRecord }> = [];
      for (const [key, record] of pending) {
        const original = this.collection.get(key);
        // The key covers the record envelope; compare values without the
        // collection's virtual metadata ($key, $synced, etc.).
        if (!record) {
          if (original) deleted.push(key);
        } else if (!original || !deepEquals(original.value, record.value)) {
          upserted.push({ type: original ? "update" : "insert", value: record });
        }
      }
      if (deleted.length === 0 && upserted.length === 0) return false;

      this.#begin({ immediate: true });
      for (const key of deleted) this.#write({ type: "delete", key });
      for (const mutation of upserted) this.#write(mutation);
      this.#commitSync();
      return true;
    } finally {
      this.#committing = false;
    }
  }

  #select(
    connectionID: string,
    sessionID?: string,
    kind?: OpenCodeDataGraphRecordKind,
  ): OpenCodeDataGraphRecord[] {
    // Equality buckets belong to the indexes. Consume synchronously without
    // mutating or retaining them, and inspect only the smallest candidate set.
    const buckets = [this.#byConnection.lookup("eq", connectionID)];
    if (sessionID !== undefined) buckets.push(this.#bySession.lookup("eq", sessionID));
    if (kind !== undefined) buckets.push(this.#byKind.lookup("eq", kind));
    const candidates = buckets.reduce((smallest, bucket) =>
      bucket.size < smallest.size ? bucket : smallest,
    );
    const result: OpenCodeDataGraphRecord[] = [];
    for (const key of candidates) {
      if (!buckets.every((bucket) => bucket.has(key))) continue;
      const record = this.collection.get(key);
      if (record) result.push(record);
    }
    return result;
  }

  selectConnectionRecords(
    connectionID: string,
    kind?: OpenCodeDataGraphRecordKind,
  ): OpenCodeDataGraphRecord[] {
    return this.#select(connectionID, undefined, kind);
  }

  selectSessionRecords(
    connectionID: string,
    sessionID: string,
    kind?: OpenCodeDataGraphRecordKind,
  ): Array<Exclude<OpenCodeDataGraphRecord, OpenCodeProjectRecord>> {
    return this.#select(connectionID, sessionID, kind).filter(
      (record): record is Exclude<OpenCodeDataGraphRecord, OpenCodeProjectRecord> =>
        record.kind !== "project",
    );
  }
}

export const openCodeDataGraph = new OpenCodeDataGraph("open-code-data-graph");
export const openCodeDataGraphCollection = openCodeDataGraph.collection;
