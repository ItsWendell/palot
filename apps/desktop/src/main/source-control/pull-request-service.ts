import type { ActivityWatermark, SessionDisposition } from "../../shared/session-triage-contract";
import type {
  LinkPullRequestInput,
  ListPullRequestLinksInput,
  PullRequestLink,
  PullRequestSearchInput,
  PullRequestSearchPage,
  PullRequestSnapshot,
  RefreshPullRequestsInput,
  SourceControlChangedEvent,
  UnlinkPullRequestInput,
  WatchPullRequestInput,
} from "../../shared/source-control-contract";
import { pullRequestKey } from "../../shared/source-control-contract";
import { GitHubApiError, type GitHubGateway, type GitHubGraphQlError } from "./github-client";
import type { GitHubPriority } from "./github-quota";
import {
  isSupportedGitHubHost,
  parseGitHubRemote,
  parsePullRequestBatch,
  parsePullRequestSearch,
  parsePullRequestUrl,
  pullRequestBatchQuery,
  pullRequestSearchQuery,
  type GitHubPullRequestRef,
  type PullRequestQueryTarget,
  type PullRequestWatchDetail,
} from "./github-pull-requests";
import { completeWatchDetail } from "./pull-request-watch-reader";
import {
  PullRequestRepository,
  toPullRequestLink,
  type LinkIdentity,
  type StoredPullRequestLink,
  type WatchIdentity,
} from "./pull-request-repository";
import {
  PULL_REQUEST_WATCH_READ_FAILURE_LIMIT,
  evaluatePullRequestWatch,
  newPullRequestWatch,
  pullRequestUnreadableMessage,
  pullRequestWatchMessage,
} from "./pull-request-watch";
import { SourceControlError } from "./errors";

/** Open links are read every sweep. */
export const PULL_REQUEST_SWEEP_INTERVAL_MS = 60_000;
/** Closed links can reopen, so they are read again this often. Merged links never are. */
export const CLOSED_PULL_REQUEST_SYNC_INTERVAL_MS = 15 * 60_000;
/** GraphQL documents stay well below GitHub's node limits. */
const BATCH_SIZE = 40;
const VIEWER_TTL_MS = 10 * 60_000;
export const SOURCE_CONTROL_PROMPT_METADATA_KEY = "palot.sourceControl";

/** What PR links need from the task's OpenCode connection. */
export interface SourceControlSessions {
  connected(profileID: string): boolean;
  /** The task's local directory. Throws `SourceControlError("not-connected")` when offline. */
  directory(profileID: string, sessionID: string): Promise<string>;
  /**
   * The latest user-authored message (Palot wakes and automations excluded). `complete: false`
   * means the search gave up before finding one, so the task must not be settled.
   */
  activity(
    profileID: string,
    sessionID: string,
  ): Promise<{
    lastUserMessageAt: number | null;
    complete: boolean;
    createdAt: number;
    updatedAt: number;
  }>;
  /** Queues a prompt that wakes the agent after its current turn. */
  prompt(
    profileID: string,
    sessionID: string,
    text: string,
    metadata: Record<string, unknown>,
  ): Promise<void>;
}

export interface SourceControlTriage {
  record(
    profileID: string,
    sessionID: string,
  ): { disposition: SessionDisposition | null; pinnedAt: number | null } | null;
  settle(profileID: string, sessionID: string, through: ActivityWatermark, at: number): void;
}

export interface PullRequestServiceOptions {
  repository: PullRequestRepository;
  github: GitHubGateway;
  sessions: SourceControlSessions;
  triage: SourceControlTriage;
  /** Whether the profile is a local connection. Null for an unknown profile. */
  isLocalProfile(profileID: string): boolean | null;
  /** Current branch and push remote URL of a directory. */
  repositoryOf(directory: string): Promise<{ remote: string | null; branch: string | null }>;
  emit(event: SourceControlChangedEvent): void;
  now?: () => number;
  env?: () => Readonly<Record<string, string | undefined>>;
  log?: { warn(message: string, data?: Record<string, unknown>): void };
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

interface SweepRequest {
  priority: GitHubPriority;
  /** Restrict to these links and read them regardless of cadence. */
  only?: (link: StoredPullRequestLink) => boolean;
}

/**
 * Task ↔ GitHub pull request links: linking, a one-minute status sweep (open every sweep,
 * closed every 15 minutes, merged never) in one batched GraphQL query, settling a task when its
 * PR merges or closes, and per-task PR watches that queue a prompt to wake the agent.
 */
export class PullRequestService {
  private readonly now: () => number;
  private readonly env: () => Readonly<Record<string, string | undefined>>;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: unknown = null;
  private readonly closedAttemptAt = new Map<string, number>();
  private readonly viewers = new Map<string, { fingerprint: string; login: string; at: number }>();
  private stopped = false;
  /** The GitHub problem last announced, so status views refresh once per change. */
  private gitHubIssue: string | null = null;

  constructor(private readonly options: PullRequestServiceOptions) {
    this.now = options.now ?? Date.now;
    this.env = options.env ?? (() => process.env);
  }

  start(): void {
    if (this.timer !== null) return;
    this.stopped = false;
    const set = this.options.setInterval ?? ((callback, ms) => setInterval(callback, ms));
    this.timer = set(() => this.backgroundSweep(), PULL_REQUEST_SWEEP_INTERVAL_MS);
    this.backgroundSweep();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      const clear =
        this.options.clearInterval ??
        ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
      clear(this.timer);
    }
    this.timer = null;
    await this.queue.catch(() => undefined);
  }

  list(input: ListPullRequestLinksInput = {}): PullRequestLink[] {
    if (input.profileID) this.assertLocal(input.profileID);
    return this.repository
      .list(input)
      .filter((link) => this.options.isLocalProfile(link.profileID) === true)
      .map(toPullRequestLink);
  }

  async link(input: LinkPullRequestInput): Promise<PullRequestLink> {
    this.assertLocal(input.profileID);
    const ref = input.url
      ? this.refFromUrl(input.url)
      : await this.refFromBranch(input.profileID, input.sessionID);
    const snapshot = await this.readOne(ref, "interactive");
    const now = this.now();
    const stored = this.repository.upsert({
      profileID: input.profileID,
      sessionID: input.sessionID,
      source: input.url ? "url" : "branch",
      snapshot,
      at: now,
    });
    // Settling follows a PR that *becomes* merged or closed, never one linked that way.
    if (isTerminal(snapshot) && stored.settleCheckedAt === null)
      this.repository.recordSettle(stored, false, now);
    this.emitPullRequests(input.profileID, [input.sessionID], "linked");
    return toPullRequestLink(this.repository.get(stored)!);
  }

  unlink(input: UnlinkPullRequestInput): void {
    this.assertLocal(input.profileID);
    if (this.repository.remove(input))
      this.emitPullRequests(input.profileID, [input.sessionID], "unlinked");
  }

  async refresh(input: RefreshPullRequestsInput): Promise<PullRequestLink[]> {
    this.assertLocal(input.profileID);
    await this.sweep({
      priority: "interactive",
      only: (link) =>
        link.profileID === input.profileID &&
        (input.sessionID === undefined || link.sessionID === input.sessionID),
    });
    return this.list({
      profileID: input.profileID,
      ...(input.sessionID ? { sessionID: input.sessionID } : {}),
    });
  }

  watch(input: WatchPullRequestInput): PullRequestLink {
    this.assertLocal(input.profileID);
    const link = this.repository.get(input);
    if (!link) throw new SourceControlError("invalid-input", "That pull request is not linked.");
    const now = this.now();
    if (input.watching) {
      if (isTerminal(link.snapshot))
        throw new SourceControlError(
          "pull-request-not-open",
          `Pull request #${link.snapshot.number} is ${link.snapshot.state}, so there is nothing to watch.`,
        );
      if (!link.watch) {
        this.repository.startWatch(link, newPullRequestWatch(now), now);
        // Record the starting point soon, so the first real change is not a minute away.
        this.backgroundSweep({ priority: "background", only: (other) => sameLink(other, link) });
      }
    } else if (link.watch) {
      this.repository.endWatch(link, "stopped", now);
    }
    this.emitPullRequests(input.profileID, [input.sessionID], "watch");
    return toPullRequestLink(this.repository.get(input)!);
  }

  async search(input: PullRequestSearchInput, host = "github.com"): Promise<PullRequestSearchPage> {
    const { query, search } = pullRequestSearchQuery(input.list, input.query);
    const data = await this.options.github.graphql<Parameters<typeof parsePullRequestSearch>[0]>({
      host,
      query,
      variables: { q: search, first: input.limit ?? 25, after: input.cursor ?? null },
      priority: "interactive",
    });
    return { list: input.list, ...parsePullRequestSearch(data, host) };
  }

  /** The signed-in GitHub login, cached per credential. */
  async viewerLogin(host = "github.com"): Promise<string | null> {
    const credential = await this.options.github.credential(host);
    const cached = this.viewers.get(host);
    if (
      cached &&
      cached.fingerprint === credential.fingerprint &&
      this.now() - cached.at < VIEWER_TTL_MS
    )
      return cached.login;
    const data = await this.options.github.graphql<{ viewer?: { login?: string } }>({
      host,
      query: "query PalotViewer { viewer { login } }",
      priority: "interactive",
    });
    const login = data.viewer?.login ?? null;
    if (login)
      this.viewers.set(host, { fingerprint: credential.fingerprint, login, at: this.now() });
    return login;
  }

  /**
   * Re-reads every local link of one PR now, at interactive priority, after a review-workspace
   * action changed it on GitHub; linked tasks then update, end their watches, or settle.
   */
  syncKey(key: string): Promise<void> {
    return this.sweep({ priority: "interactive", only: (link) => link.key === key }).catch(
      (error) =>
        this.options.log?.warn("pull request sync after action failed", { error: String(error) }),
    );
  }

  /** One pass; passes run one at a time. */
  sweep(request: SweepRequest = { priority: "background" }): Promise<void> {
    const next = this.queue.then(() => (this.stopped ? undefined : this.runSweep(request)));
    this.queue = next.catch((error) =>
      this.options.log?.warn("pull request sweep failed", { error: String(error) }),
    );
    return next;
  }

  private backgroundSweep(request: SweepRequest = { priority: "background" }): void {
    this.sweep(request).catch(() => undefined);
  }

  private get repository() {
    return this.options.repository;
  }

  private assertLocal(profileID: string): void {
    const local = this.options.isLocalProfile(profileID);
    if (local === null)
      throw new SourceControlError("unknown-profile", "Unknown OpenCode profile.");
    if (!local)
      throw new SourceControlError(
        "unsupported-connection",
        "Pull requests and Git actions are only available for local OpenCode connections.",
      );
  }

  private refFromUrl(url: string): GitHubPullRequestRef {
    const ref = parsePullRequestUrl(url);
    if (!ref)
      throw new SourceControlError(
        "invalid-input",
        "Paste a GitHub pull request URL, such as https://github.com/owner/repo/pull/123.",
      );
    if (!isSupportedGitHubHost(ref.host, this.env()))
      throw new SourceControlError(
        "unsupported-remote",
        `${ref.host} is not a supported GitHub host.`,
      );
    return ref;
  }

  private async refFromBranch(profileID: string, sessionID: string): Promise<GitHubPullRequestRef> {
    const directory = await this.options.sessions.directory(profileID, sessionID);
    const { remote, branch } = await this.options.repositoryOf(directory);
    if (!remote)
      throw new SourceControlError("no-remote", "The task's repository has no origin remote.");
    const repo = parseGitHubRemote(remote);
    if (!repo || !isSupportedGitHubHost(repo.host, this.env()))
      throw new SourceControlError(
        "unsupported-remote",
        "The task's origin remote is not on GitHub.",
      );
    if (!branch)
      throw new SourceControlError("detached-head", "The task's directory is not on a branch.");
    const response = await this.options.github.rest<
      Array<{ number?: number; state?: string; updated_at?: string }>
    >({
      host: repo.host,
      path: `repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/pulls?head=${encodeURIComponent(`${repo.owner}:${branch}`)}&state=all&sort=updated&direction=desc&per_page=10`,
      priority: "interactive",
    });
    const pulls = Array.isArray(response.data) ? response.data : [];
    const chosen = pulls.find((pull) => pull.state === "open") ?? pulls[0];
    if (!chosen || typeof chosen.number !== "number")
      throw new SourceControlError(
        "no-pull-request",
        `No pull request found for branch ${branch} in ${repo.owner}/${repo.name}.`,
      );
    return { ...repo, number: chosen.number };
  }

  private async readOne(ref: GitHubPullRequestRef, priority: GitHubPriority) {
    const targets = [{ ref, watched: false }];
    const { query, variables } = pullRequestBatchQuery(targets);
    const data = await this.options.github.graphql<Record<string, unknown>>({
      host: ref.host,
      query,
      variables,
      priority,
    });
    const snapshot = parsePullRequestBatch(data, targets).entries[0]?.snapshot;
    if (!snapshot)
      throw new SourceControlError(
        "github-not-found",
        `GitHub could not find ${ref.owner}/${ref.name}#${ref.number}, or the credential cannot see it.`,
      );
    return snapshot;
  }

  private async runSweep(request: SweepRequest): Promise<void> {
    const now = this.now();
    const links = this.repository
      .list()
      .filter((link) => this.options.isLocalProfile(link.profileID) === true);
    const changed = new Map<string, Set<string>>();
    const touch = (link: LinkIdentity) => {
      const sessions = changed.get(link.profileID) ?? new Set<string>();
      sessions.add(link.sessionID);
      changed.set(link.profileID, sessions);
    };

    // Watches end without a read when the task was settled.
    for (const link of links) {
      if (!link.watch) continue;
      if (this.options.triage.record(link.profileID, link.sessionID)?.disposition === "settled") {
        if (this.repository.endWatch(link, "settled", now, link.watch)) touch(link);
      }
    }

    const groups = new Map<string, StoredPullRequestLink[]>();
    for (const link of this.repository
      .list()
      .filter((item) => this.options.isLocalProfile(item.profileID) === true)) {
      if (request.only && !request.only(link)) continue;
      groups.set(link.key, [...(groups.get(link.key) ?? []), link]);
    }
    const due = [...groups.values()].filter((members) => this.isDue(members, now, request));

    const byHost = new Map<string, StoredPullRequestLink[][]>();
    for (const members of due) {
      const host = members[0]!.snapshot.host;
      // A persisted link can name a host the current environment no longer trusts (GH_HOST
      // changed). Never ask for, or send, a credential to it.
      if (!isSupportedGitHubHost(host, this.env())) {
        const message = `GitHub host ${host} is not configured. Set GH_HOST=${host} to sync this pull request.`;
        for (const link of members) await this.failRead(link, message, now, touch);
        continue;
      }
      byHost.set(host, [...(byHost.get(host) ?? []), members]);
    }
    for (const [host, hostGroups] of byHost) {
      for (let start = 0; start < hostGroups.length; start += BATCH_SIZE) {
        await this.readBatch(host, hostGroups.slice(start, start + BATCH_SIZE), request, touch);
      }
    }

    await this.settleTerminal(touch);
    for (const [profileID, sessionIDs] of changed)
      this.emitPullRequests(profileID, [...sessionIDs], "synced");
  }

  private isDue(members: StoredPullRequestLink[], now: number, request: SweepRequest): boolean {
    if (request.only) return true;
    const first = members[0]!;
    if (members.some((link) => link.syncedAt === null)) return true;
    const state = first.snapshot.state;
    if (state === "open" || state === "draft") return true;
    if (state === "merged") return false;
    const last = Math.max(
      this.closedAttemptAt.get(first.key) ?? 0,
      ...members.map((link) => link.syncedAt ?? 0),
    );
    return now - last >= CLOSED_PULL_REQUEST_SYNC_INTERVAL_MS;
  }

  private async readBatch(
    host: string,
    groups: StoredPullRequestLink[][],
    request: SweepRequest,
    touch: (link: LinkIdentity) => void,
  ): Promise<void> {
    const now = this.now();
    const targets: PullRequestQueryTarget[] = groups.map((members) => {
      const [owner = "", name = ""] = members[0]!.snapshot.repository.split("/");
      return {
        ref: { host, owner, name, number: members[0]!.snapshot.number },
        watched: members.some((link) => link.watch !== null),
      };
    });
    for (const members of groups) {
      if (members[0]!.snapshot.state === "closed") this.closedAttemptAt.set(members[0]!.key, now);
    }
    let result: ReturnType<typeof parsePullRequestBatch>;
    let errors: GitHubGraphQlError[];
    try {
      const { query, variables } = pullRequestBatchQuery(targets);
      const answer = await this.options.github.graphqlPartial<Record<string, unknown>>({
        host,
        query,
        variables,
        priority: request.priority,
      });
      result = parsePullRequestBatch(answer.data, targets);
      errors = answer.errors;
    } catch (error) {
      if (error instanceof GitHubApiError) this.noteGitHubIssue(host, error.code);
      // A rate limit is GitHub asking Palot to wait, not a sign the PR cannot be read.
      if (error instanceof GitHubApiError && error.code === "rate-limited") {
        if (request.priority === "interactive") throw error;
        return;
      }
      const message = error instanceof Error ? error.message : "GitHub read failed";
      for (const members of groups)
        for (const link of members) await this.failRead(link, message, now, touch);
      if (request.priority === "interactive") throw error;
      return;
    }
    this.noteGitHubIssue(host, null);
    if (result.viewer) {
      const credential = await this.options.github.credential(host).catch(() => null);
      if (credential)
        this.viewers.set(host, {
          fingerprint: credential.fingerprint,
          login: result.viewer,
          at: now,
        });
    }
    // Errors belong to the alias their path starts with; the other targets keep their data.
    const errorsByAlias = new Map<string, GitHubGraphQlError[]>();
    for (const error of errors) {
      const alias = typeof error.path?.[0] === "string" ? error.path[0] : "";
      errorsByAlias.set(alias, [...(errorsByAlias.get(alias) ?? []), error]);
    }
    for (const [index, members] of groups.entries()) {
      const entry = result.entries[index]!;
      const aliasErrors = errorsByAlias.get(`pr${index}`) ?? [];
      if (!entry.snapshot) {
        const message = aliasErrors.every((error) => error.type === "NOT_FOUND")
          ? "GitHub could not find this pull request, or the credential cannot see it."
          : `GitHub returned an error: ${aliasErrors.map((error) => error.message ?? error.type ?? "unknown").join("; ")}`;
        for (const link of members) await this.failRead(link, message, now, touch);
        continue;
      }
      const watched = members.filter((link) => link.watch !== null);
      let detail: PullRequestWatchDetail | null = null;
      if (entry.watch && watched.length > 0) {
        detail = await completeWatchDetail({
          github: this.options.github,
          host,
          number: entry.snapshot.number,
          page: entry.watch,
          snapshot: entry.snapshot,
          // The oldest watermark among the tasks watching this PR.
          since: Math.min(...watched.map((link) => link.watch!.remarksThrough)),
          priority: request.priority,
        });
      }
      for (const link of members) {
        if (snapshotChanged(link.snapshot, entry.snapshot) || link.syncError) touch(link);
        this.repository.recordSnapshot(link, entry.snapshot, now);
        if (!link.watch) continue;
        if (!detail && !isTerminal(entry.snapshot)) {
          // The PR was read but its checks and remarks were not: a failed read for the watch.
          await this.failRead(
            link,
            "GitHub returned the pull request without its checks and comments.",
            now,
            touch,
          );
          continue;
        }
        await this.advanceWatch(link, entry.snapshot, detail, result.viewer, now, touch);
      }
    }
  }

  private async failRead(
    link: StoredPullRequestLink,
    message: string,
    now: number,
    touch: (link: LinkIdentity) => void,
  ): Promise<void> {
    if (link.syncError !== message) touch(link);
    this.repository.recordSyncError(link, message, now);
    if (!link.watch) return;
    // The watch this read belonged to may have been stopped or replaced meanwhile.
    const current = this.repository.currentWatch(link, link.watch);
    if (!current) return;
    const readFailures = current.watch.readFailures + 1;
    touch(link);
    if (readFailures < PULL_REQUEST_WATCH_READ_FAILURE_LIMIT) {
      this.repository.updateWatch(link, { ...current.watch, readFailures }, now);
      return;
    }
    if (
      this.options.sessions.connected(link.profileID) &&
      this.stillWatching(link, current.watch)
    ) {
      await this.options.sessions
        .prompt(
          link.profileID,
          link.sessionID,
          pullRequestUnreadableMessage({ number: link.snapshot.number, url: link.snapshot.url }),
          this.metadata(link, ["unreadable"]),
        )
        .catch((error) =>
          this.options.log?.warn("pull request watch stop wake failed", { error: String(error) }),
        );
    }
    this.repository.endWatch(link, "unreadable", now, current.watch);
  }

  /**
   * Whether `watch` is still the link's live watch and its task is not settled, checked right
   * before a wake: a stop, unlink, restart or settle during the GitHub read wins.
   */
  private stillWatching(link: LinkIdentity, watch: WatchIdentity): boolean {
    if (!this.repository.currentWatch(link, watch)) return false;
    if (this.options.triage.record(link.profileID, link.sessionID)?.disposition === "settled") {
      this.repository.endWatch(link, "settled", this.now(), watch);
      return false;
    }
    return true;
  }

  private async advanceWatch(
    link: StoredPullRequestLink,
    snapshot: PullRequestSnapshot,
    detail: PullRequestWatchDetail | null,
    viewer: string | null,
    now: number,
    touch: (link: LinkIdentity) => void,
  ): Promise<void> {
    const watch = link.watch!;
    if (snapshot.state === "merged" || snapshot.state === "closed") {
      if (this.repository.endWatch(link, snapshot.state, now, watch)) touch(link);
      return;
    }
    // Waking needs the task's connection; leave the state untouched so the news waits.
    if (!detail || !this.options.sessions.connected(link.profileID)) return;
    const report = evaluatePullRequestWatch(watch, detail, viewer);
    if (!this.stillWatching(link, watch)) {
      touch(link);
      return;
    }
    if (report.changes.length === 0) {
      if (JSON.stringify(report.next) !== JSON.stringify(watch))
        this.repository.updateWatch(link, report.next, now);
      return;
    }
    try {
      await this.options.sessions.prompt(
        link.profileID,
        link.sessionID,
        pullRequestWatchMessage({
          number: snapshot.number,
          url: snapshot.url,
          baseBranch: detail.baseBranch,
          headSha: report.next.headSha,
          report,
        }),
        this.metadata(
          link,
          report.changes.map((change) => change.kind),
        ),
      );
    } catch (error) {
      // Not recorded, so the next sweep reports the same news.
      this.options.log?.warn("pull request watch wake failed", { error: String(error) });
      return;
    }
    touch(link);
    if (report.exhausted) this.repository.endWatch(link, "comment-limit", now, watch);
    else this.repository.updateWatch(link, { ...report.next, lastWakeAt: now }, now);
  }

  /** Settles tasks whose linked PR became merged or closed. */
  private async settleTerminal(touch: (link: LinkIdentity) => void): Promise<void> {
    const now = this.now();
    const links = this.repository
      .list()
      .filter((link) => this.options.isLocalProfile(link.profileID) === true);
    for (const link of links) {
      if (!isTerminal(link.snapshot) || link.settleCheckedAt !== null) continue;
      if (!this.options.sessions.connected(link.profileID)) continue;
      // Another open PR on the same task still holds it open.
      const openSibling = links.some(
        (other) =>
          other.profileID === link.profileID &&
          other.sessionID === link.sessionID &&
          other.key !== link.key &&
          !isTerminal(other.snapshot),
      );
      const record = this.options.triage.record(link.profileID, link.sessionID);
      if (openSibling || record?.pinnedAt != null || record?.disposition === "settled") {
        this.repository.recordSettle(link, false, now);
        continue;
      }
      let activity: Awaited<ReturnType<SourceControlSessions["activity"]>>;
      try {
        activity = await this.options.sessions.activity(link.profileID, link.sessionID);
      } catch (error) {
        this.options.log?.warn("pull request settle check failed", { error: String(error) });
        continue;
      }
      const terminalAt = link.snapshot.mergedAt ?? link.snapshot.closedAt ?? now;
      const userAt = activity.lastUserMessageAt ?? activity.createdAt;
      // Unknown user activity errs on keeping the task in the inbox.
      if (!activity.complete || userAt > terminalAt) {
        this.repository.recordSettle(link, false, now);
        continue;
      }
      this.options.triage.settle(
        link.profileID,
        link.sessionID,
        { updatedAt: activity.updatedAt, sessionID: link.sessionID },
        now,
      );
      this.repository.recordSettle(link, true, now);
      if (link.watch) this.repository.endWatch(link, "settled", now);
      touch(link);
      this.emitPullRequests(link.profileID, [link.sessionID], "settled");
    }
  }

  private noteGitHubIssue(host: string, code: string | null): void {
    const issue = code === null || code === "not-found" ? null : code;
    if (issue === this.gitHubIssue) return;
    this.gitHubIssue = issue;
    this.options.emit({ type: "github", host });
  }

  private metadata(link: StoredPullRequestLink, changes: string[]): Record<string, unknown> {
    return {
      [SOURCE_CONTROL_PROMPT_METADATA_KEY]: {
        version: 1,
        kind: "pull-request-watch",
        pullRequest: link.key,
        url: link.snapshot.url,
        changes,
      },
    };
  }

  private emitPullRequests(
    profileID: string,
    sessionIDs: string[],
    reason: Extract<SourceControlChangedEvent, { type: "pull-requests" }>["reason"],
  ): void {
    this.options.emit({ type: "pull-requests", profileID, sessionIDs, reason });
  }
}

function isTerminal(snapshot: PullRequestSnapshot): boolean {
  return snapshot.state === "merged" || snapshot.state === "closed";
}

function sameLink(left: LinkIdentity, right: LinkIdentity): boolean {
  return (
    left.profileID === right.profileID &&
    left.sessionID === right.sessionID &&
    left.key === right.key
  );
}

function snapshotChanged(left: PullRequestSnapshot, right: PullRequestSnapshot): boolean {
  return (
    pullRequestKey(left) !== pullRequestKey(right) || JSON.stringify(left) !== JSON.stringify(right)
  );
}
