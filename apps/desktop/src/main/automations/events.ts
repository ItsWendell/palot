import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AutomationRecord } from "../../shared";
import { pullRequestEvents } from "../source-control/pull-request-events";
import type { StoredPullRequestLink } from "../source-control/pull-request-repository";
import {
  evaluatePullRequestWatch,
  newPullRequestWatch,
  type PullRequestWatchState,
} from "../source-control/pull-request-watch";
import { AutomationWebhookServer } from "./webhook";

export interface AutomationEvent {
  key: string;
  at: number;
  payload: Record<string, unknown>;
}
interface EventState {
  pending: Record<string, AutomationEvent>;
  seen: Record<string, string[]>;
  watches: Record<string, PullRequestWatchState>;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Durable, bounded last-event-wins mailbox per automation, independent of active run recovery. */
export class AutomationEvents {
  private state: EventState = { pending: {}, seen: {}, watches: {} };
  private queue: Promise<unknown> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;
  private stopped = false;
  readonly webhook: AutomationWebhookServer;

  constructor(
    private readonly options: {
      directory: string;
      definitions(): AutomationRecord[];
      /** False leaves the event pending (offline, busy, or global concurrency limit). */
      admit(record: AutomationRecord, event: AutomationEvent, expired: boolean): boolean;
      changed(): void;
      now?: () => number;
    },
  ) {
    this.webhook = new AutomationWebhookServer({
      definitions: options.definitions,
      accept: (record, payload, deliveryID) => this.accept(record, payload, deliveryID),
      // Closing the listener during quit must not ask a still-live renderer to reload
      // automation state after the app has moved on to closing SQLite.
      changed: () => {
        if (!this.stopped) options.changed();
      },
    });
  }

  async start(): Promise<void> {
    try {
      this.state = JSON.parse(await readFile(this.file(), "utf8")) as EventState;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
        throw error;
    }
    this.unsubscribe = pullRequestEvents.subscribe({
      matches: (link) =>
        !this.stopped &&
        this.options.definitions().some((record) => matchesPullRequest(record, link)),
      detail: (link, snapshot, detail, viewer) =>
        this.serialized(async () => {
          if (this.stopped) return;
          for (const record of this.options.definitions()) {
            if (!matchesPullRequest(record, { ...link, snapshot })) continue;
            const key = `${record.id}:${record.definitionVersion}:${link.key}`;
            const watch = this.state.watches[key] ?? newPullRequestWatch(record.updatedAt);
            // Check URLs identify a CI attempt even when the next poll misses its pending phase.
            const identified = {
              ...detail,
              checks: detail.checks.map((check) => ({
                ...check,
                name: `${check.name}\0${check.url ?? ""}`,
              })),
            };
            const report = evaluatePullRequestWatch(watch, identified, viewer);
            this.state.watches[key] = report.next;
            const changes = report.changes.filter(
              (change) =>
                record.trigger.type === "pull-request" && change.kind === record.trigger.event,
            );
            if (!changes.length) continue;
            this.record(
              record,
              {
                event: record.trigger.type === "pull-request" ? record.trigger.event : "",
                repository: snapshot.repository,
                branch: snapshot.headBranch,
                number: snapshot.number,
                url: snapshot.url,
                headSha: detail.headSha,
                checks: detail.checks,
                remarks: detail.remarks.filter((remark) => remark.activeAt >= watch.remarksThrough),
              },
              hash(
                JSON.stringify([
                  link.key,
                  detail.headSha,
                  changes,
                  detail.checks.map((check) => [check.name, check.url, check.status]),
                ]),
              ),
            );
          }
          await this.persist();
          await this.drain();
        }),
    });
    await this.refresh();
  }

  refresh(): Promise<void> {
    return this.serialized(async () => {
      if (this.stopped) return;
      const definitions = this.options.definitions();
      const active = new Set(
        definitions.filter((record) => record.status === "active").map((record) => record.id),
      );
      for (const id of Object.keys(this.state.pending))
        if (!active.has(id)) delete this.state.pending[id];
      for (const id of Object.keys(this.state.seen))
        if (!definitions.some((record) => record.id === id)) delete this.state.seen[id];
      const versions = definitions.map((record) => `${record.id}:${record.definitionVersion}:`);
      for (const key of Object.keys(this.state.watches))
        if (!versions.some((prefix) => key.startsWith(prefix))) delete this.state.watches[key];
      await this.webhook.refresh();
      await this.drain();
      await this.persist();
    });
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.queue;
    await this.webhook.close();
  }

  accept(
    record: AutomationRecord,
    payload: Record<string, unknown>,
    deliveryID: string | null,
  ): Promise<string> {
    return this.serialized(async () => {
      if (this.stopped) throw new Error("Automation events stopped");
      // Pausing/deleting while a request body streams wins.
      const current = this.options
        .definitions()
        .find((item) => item.id === record.id && item.status === "active");
      if (!current || current.definitionVersion !== record.definitionVersion)
        throw new Error("Automation changed");
      const key = deliveryID
        ? hash(deliveryID)
        : hash(`${Math.floor(this.now() / 60_000)}:${JSON.stringify(payload)}`);
      const result = this.record(current, payload, key);
      await this.persist(); // Acknowledge only after durable receipt.
      await this.drain();
      return result;
    });
  }

  private record(record: AutomationRecord, payload: Record<string, unknown>, key: string): string {
    const seen = this.state.seen[record.id] ?? [];
    if (seen.includes(key)) return "duplicate";
    const coalesced = Boolean(this.state.pending[record.id]);
    this.state.pending[record.id] = { key, at: this.now(), payload };
    this.state.seen[record.id] = [...seen.slice(-255), key];
    return coalesced ? "coalesced" : "accepted";
  }

  private async drain(): Promise<void> {
    if (this.stopped) return;
    for (const record of this.options.definitions()) {
      const event = this.state.pending[record.id];
      if (!event || record.status !== "active") continue;
      const maxAge = record.missedRuns.type === "skip" ? 60_000 : record.missedRuns.maxAgeMs;
      if (this.options.admit(record, event, this.now() - event.at > maxAge))
        delete this.state.pending[record.id];
    }
    await this.persist();
  }
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  private file(): string {
    return path.join(this.options.directory, "event-state.json");
  }
  private async persist(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.file()}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state), { mode: 0o600 });
    await rename(temporary, this.file());
  }
}

export function matchesPullRequest(record: AutomationRecord, link: StoredPullRequestLink): boolean {
  const trigger = record.trigger;
  return (
    record.status === "active" &&
    trigger.type === "pull-request" &&
    record.profileID === link.profileID &&
    (!trigger.repository ||
      trigger.repository.toLowerCase() === link.snapshot.repository.toLowerCase()) &&
    (!trigger.branch || trigger.branch === link.snapshot.headBranch)
  );
}

/** JSON string literals delimit untrusted values, escape control characters and cap expansion.
 * Like T3 Code's webhookTemplate, only own properties are traversed. No evaluation or recursive expansion.
 */
export function renderEventPrompt(prompt: string, payload: Record<string, unknown>): string {
  let remaining = 16_000;
  return prompt.replace(/\{\{payload\.([a-zA-Z0-9_.-]{1,200})\}\}/g, (_match, field: string) => {
    let value: unknown = payload;
    for (const key of field.split(".")) {
      if (
        !value ||
        typeof value !== "object" ||
        ["__proto__", "prototype", "constructor"].includes(key) ||
        !Object.hasOwn(value, key)
      ) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[key];
    }
    const limit = Math.min(2000, remaining);
    if (limit < 2) return "";
    const encoded = JSON.stringify(value ?? "");
    // Truncate before encoding a shortened value, so a cap never leaves an open quote
    // or half an escape. Six characters covers JSON's longest character escape.
    const text =
      encoded.length <= limit
        ? encoded
        : JSON.stringify(encoded.slice(0, Math.floor((limit - 2) / 6)));
    remaining -= text.length;
    return text;
  });
}
