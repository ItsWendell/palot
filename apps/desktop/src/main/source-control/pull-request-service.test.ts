// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PullRequestSnapshot,
  SourceControlChangedEvent,
} from "../../shared/source-control-contract";
import { openPalotDatabase } from "../database/client";
import { GitHubApiError, type GitHubGateway, type GitHubGraphQlError } from "./github-client";
import {
  CLOSED_PULL_REQUEST_SYNC_INTERVAL_MS,
  PULL_REQUEST_SWEEP_INTERVAL_MS,
  PullRequestService,
  type SourceControlSessions,
  type SourceControlTriage,
} from "./pull-request-service";
import { PullRequestRepository } from "./pull-request-repository";
import { pullRequestEvents } from "./pull-request-events";
import { PULL_REQUEST_WATCH_READ_FAILURE_LIMIT } from "./pull-request-watch";
import { SourceControlService } from "./source-control-service";

const T0 = Date.parse("2026-10-10T12:00:00Z");
const PROFILE = "local-profile";

interface RawPull {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  mergedAt?: string | null;
  closedAt?: string | null;
  mergeable?: string;
  headSha?: string;
  checks?: Array<{ name: string; status: string; conclusion?: string | null; required?: boolean }>;
  comments?: Array<{ id: string; author: string; body: string; createdAt: string }>;
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function pullNode(owner: string, name: string, pull: RawPull) {
  return {
    number: pull.number,
    title: `PR ${pull.number}`,
    url: `https://github.com/${owner}/${name}/pull/${pull.number}`,
    state: pull.state,
    isDraft: false,
    mergedAt: pull.mergedAt ?? null,
    closedAt: pull.closedAt ?? null,
    updatedAt: "2026-10-10T11:00:00Z",
    headRefName: "feature",
    baseRefName: "main",
    headRefOid: pull.headSha ?? "abc1234",
    mergeable: pull.mergeable ?? "MERGEABLE",
    reviewDecision: null,
    author: { login: "me" },
    repository: { nameWithOwner: `${owner}/${name}` },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] },
  };
}

function watchNode(pull: RawPull) {
  return {
    commits: {
      nodes: [
        {
          commit: {
            oid: pull.headSha ?? "abc1234",
            statusCheckRollup: {
              contexts: {
                nodes: (pull.checks ?? []).map((check) => ({
                  __typename: "CheckRun",
                  name: check.name,
                  status: check.status,
                  conclusion: check.conclusion ?? null,
                  detailsUrl: null,
                  isRequired: check.required ?? false,
                })),
              },
            },
          },
        },
      ],
    },
    comments: {
      nodes: (pull.comments ?? []).map((comment) => ({
        id: comment.id,
        url: null,
        body: comment.body,
        createdAt: comment.createdAt,
        lastEditedAt: null,
        author: { login: comment.author },
      })),
    },
    reviews: { nodes: [] },
    reviewThreads: { nodes: [] },
  };
}

/** A GitHub fake that answers the batched document from a table of pull requests. */
function fakeGitHub() {
  const pulls = new Map<string, RawPull>();
  const reads: Array<{ keys: string[]; priority: string }> = [];
  /** Repositories GitHub answers as NOT_FOUND inside an otherwise successful document. */
  const missing = new Set<string>();
  const hooks: { beforeAnswer?: () => void } = {};
  let failure: Error | null = null;
  const partial = vi.fn(
    async (input: {
      query: string;
      variables?: Record<string, unknown>;
      priority: "interactive" | "background";
    }) => {
      if (failure) throw failure;
      hooks.beforeAnswer?.();
      const data: Record<string, unknown> = { viewer: { login: "me" } };
      const errors: GitHubGraphQlError[] = [];
      const keys: string[] = [];
      const matches = [
        ...input.query.matchAll(
          /pr(\d+): repository\(owner: \$o\d+, name: \$n\d+\) \{\s*pullRequest\(number: (\d+)\)/g,
        ),
      ];
      for (const [position, match] of matches.entries()) {
        const index = match[1]!;
        const owner = String(input.variables?.[`o${index}`]);
        const name = String(input.variables?.[`n${index}`]);
        const key = `${owner}/${name}#${match[2]}`;
        keys.push(key);
        const pull = pulls.get(key);
        if (missing.has(key)) {
          data[`pr${index}`] = null;
          errors.push({ type: "NOT_FOUND", message: "Could not resolve", path: [`pr${index}`] });
          continue;
        }
        const segment = input.query.slice(match.index, matches[position + 1]?.index);
        data[`pr${index}`] = pull
          ? {
              pullRequest: pullNode(owner, name, pull),
              ...(segment.includes("watch: pullRequest") ? { watch: watchNode(pull) } : {}),
            }
          : { pullRequest: null };
      }
      reads.push({ keys, priority: input.priority });
      return { data, errors };
    },
  );
  const graphql = vi.fn(
    async (input: Parameters<typeof partial>[0]) => (await partial(input)).data,
  );
  const rest = vi.fn(async (_input: Parameters<GitHubGateway["rest"]>[0]) => ({
    status: 200,
    data: [] as unknown,
    notModified: false,
  }));
  const gateway: GitHubGateway = {
    graphql: graphql as GitHubGateway["graphql"],
    graphqlPartial: partial as GitHubGateway["graphqlPartial"],
    rest: rest as GitHubGateway["rest"],
    credential: async () => ({ source: "env", fingerprint: "github.com:fake" }),
    pausedUntil: () => null,
  };
  return {
    gateway,
    graphql,
    graphqlPartial: partial,
    rest,
    pulls,
    reads,
    missing,
    hooks,
    fail(error: Error | null) {
      failure = error;
    },
  };
}

async function setup(env: Record<string, string | undefined> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "palot-source-control-"));
  roots.push(root);
  const database = openPalotDatabase(path.join(root, "palot.sqlite"), path.resolve("drizzle"));
  const repository = new PullRequestRepository(database);
  const github = fakeGitHub();
  let now = T0;
  const connected = new Set([PROFILE]);
  const activity = {
    lastUserMessageAt: (T0 - 60_000) as number | null,
    complete: true,
    createdAt: T0 - 120_000,
  };
  const prompts: Array<{ sessionID: string; text: string; metadata: Record<string, unknown> }> = [];
  const sessions: SourceControlSessions = {
    connected: (profileID) => connected.has(profileID),
    directory: async () => "/work/repo",
    activity: async () => ({ ...activity, updatedAt: now - 1_000 }),
    prompt: async (_profileID, sessionID, text, metadata) => {
      prompts.push({ sessionID, text, metadata });
    },
  };
  const triageRecords = new Map<
    string,
    { disposition: "inbox" | "settled" | null; pinnedAt: number | null }
  >();
  const settles: Array<{ sessionID: string; through: { updatedAt: number; sessionID: string } }> =
    [];
  const triage: SourceControlTriage = {
    record: (_profileID, sessionID) => triageRecords.get(sessionID) ?? null,
    settle: (_profileID, sessionID, through) => {
      settles.push({ sessionID, through });
      triageRecords.set(sessionID, { disposition: "settled", pinnedAt: null });
    },
  };
  const events: SourceControlChangedEvent[] = [];
  const repositoryOf = vi.fn(async () => ({
    remote: "git@github.com:Acme/Web.git",
    branch: "feature",
  }));
  const isLocalProfile = (profileID: string) =>
    profileID === PROFILE ? true : profileID === "remote-profile" ? false : null;
  const git = {
    pullRequestContext: vi.fn(async () => ({
      branch: "feature",
      base: "main",
      branches: ["main"],
      diff: "branch diff",
      commits: "Add feature",
      pushed: true,
    })),
  };
  const service = new PullRequestService({
    repository,
    github: github.gateway,
    sessions,
    triage,
    isLocalProfile,
    repositoryOf,
    git,
    emit: (event) => events.push(event),
    now: () => now,
    env: () => env,
  });
  return {
    database,
    repository,
    github,
    service,
    facade: new SourceControlService({
      pullRequests: service,
      review: {} as never,
      git: {} as never,
      github: github.gateway,
      isLocalProfile,
      emit: (event) => events.push(event),
      env: () => env,
    }),
    sessions: { connected, activity, prompts },
    triageRecords,
    settles,
    events,
    repositoryOf,
    git,
    advance(ms: number) {
      now += ms;
    },
    now: () => now,
    link(
      sessionID: string,
      number: number,
      state: PullRequestSnapshot["state"],
      host = "github.com",
    ) {
      return repository.upsert({
        profileID: PROFILE,
        sessionID,
        source: "url",
        at: now,
        snapshot: {
          host,
          repository: "acme/web",
          number,
          title: `PR ${number}`,
          url: `https://github.com/acme/web/pull/${number}`,
          state,
          checks: "pending",
          reviewDecision: null,
          mergeable: "mergeable",
          headBranch: "feature",
          baseBranch: "main",
          author: "me",
          updatedAt: now,
          mergedAt: state === "merged" ? now : null,
          closedAt: state === "closed" ? now : null,
        },
      });
    },
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;
let context: Setup;

beforeEach(async () => {
  context = await setup();
});

afterEach(() => {
  context.database.$client.close();
});

describe("pull request status sync", () => {
  it("reads and publishes event detail for linked PRs without enabling a task watch", async () => {
    context.link("s1", 7, "open");
    const detail = vi.fn(async () => {});
    const unsubscribe = pullRequestEvents.subscribe({ matches: () => true, detail });
    try {
      context.github.pulls.set("acme/web#7", {
        number: 7,
        state: "OPEN",
        checks: [{ name: "CI", status: "IN_PROGRESS" }],
      });
      await context.service.refresh({ profileID: PROFILE, sessionID: "s1" });
      expect(detail).toHaveBeenLastCalledWith(
        expect.objectContaining({ sessionID: "s1" }),
        expect.objectContaining({ number: 7 }),
        expect.objectContaining({ checks: [expect.objectContaining({ status: "pending" })] }),
        "me",
      );
      context.github.pulls.set("acme/web#7", {
        number: 7,
        state: "OPEN",
        checks: [{ name: "CI", status: "COMPLETED", conclusion: "FAILURE" }],
      });
      await context.service.refresh({ profileID: PROFILE, sessionID: "s1" });
      expect(detail).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ checks: [expect.objectContaining({ status: "failure" })] }),
        "me",
      );
      expect(context.sessions.prompts).toEqual([]);
    } finally {
      unsubscribe();
    }
  });
  it("reads open links every sweep, closed every 15 minutes, and merged never, batched", async () => {
    const { github, service } = context;
    context.link("s-open", 1, "open");
    context.link("s-open-2", 1, "open");
    context.link("s-closed", 2, "closed");
    context.link("s-merged", 3, "merged");
    github.pulls.set("acme/web#1", { number: 1, state: "OPEN" });
    github.pulls.set("acme/web#2", {
      number: 2,
      state: "CLOSED",
      closedAt: "2026-10-10T11:00:00Z",
    });

    context.advance(PULL_REQUEST_SWEEP_INTERVAL_MS);
    await service.sweep();
    // One request; the PR shared by two tasks is read once.
    expect(github.reads).toEqual([{ keys: ["acme/web#1"], priority: "background" }]);

    context.advance(CLOSED_PULL_REQUEST_SYNC_INTERVAL_MS);
    await service.sweep();
    expect(github.reads[1]).toEqual({
      keys: ["acme/web#1", "acme/web#2"],
      priority: "background",
    });

    context.advance(PULL_REQUEST_SWEEP_INTERVAL_MS);
    await service.sweep();
    expect(github.reads[2]?.keys).toEqual(["acme/web#1"]);
    expect(github.reads.flatMap((read) => read.keys)).not.toContain("acme/web#3");
  });

  it("refreshes a task's links at interactive priority regardless of cadence", async () => {
    context.link("s1", 3, "merged");
    context.github.pulls.set("acme/web#3", {
      number: 3,
      state: "MERGED",
      mergedAt: "2026-10-10T11:30:00Z",
    });
    const links = await context.service.refresh({ profileID: PROFILE, sessionID: "s1" });
    expect(context.github.reads).toEqual([{ keys: ["acme/web#3"], priority: "interactive" }]);
    expect(links).toHaveLength(1);
  });

  it("returns an unsupported result for remote connections", async () => {
    const result = await context.facade.linkPullRequest({
      profileID: "remote-profile",
      sessionID: "s1",
      url: "https://github.com/acme/web/pull/1",
    });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "unsupported-connection" }),
    });
    expect(context.github.graphql).not.toHaveBeenCalled();
  });

  it("detects the pull request from the task's branch", async () => {
    context.github.rest.mockResolvedValueOnce({
      status: 200,
      notModified: false,
      data: [
        { number: 4, state: "closed" },
        { number: 5, state: "open" },
      ],
    });
    context.github.pulls.set("acme/web#5", { number: 5, state: "OPEN" });
    const link = await context.service.link({ profileID: PROFILE, sessionID: "s1" });
    expect(link).toMatchObject({ key: "github.com/acme/web#5", source: "branch" });
    expect(context.github.rest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("repos/acme/web/pulls?head=acme%3Afeature&state=all"),
        priority: "interactive",
      }),
    );
    expect(context.events).toContainEqual({
      type: "pull-requests",
      profileID: PROFILE,
      sessionIDs: ["s1"],
      reason: "linked",
    });
  });
});

describe("creating and automatically linking pull requests", () => {
  const input = {
    profileID: PROFILE,
    sessionID: "task",
    base: "main",
    title: "Add feature",
    body: "Summary",
    draft: true,
  };

  function creationApi() {
    let created = false;
    context.github.pulls.set("acme/web#71", { number: 71, state: "OPEN" });
    context.github.rest.mockImplementation(async (request) => {
      if (request.method === "POST") {
        created = true;
        return { status: 201, data: { number: 71 }, notModified: false };
      }
      if (request.path.includes("/pulls?"))
        return { status: 200, data: created ? [{ number: 71 }] : [], notModified: false };
      return { status: 200, data: { default_branch: "main" }, notModified: false };
    });
  }

  it("creates with the edited fields, links automatically, and reuses an existing PR", async () => {
    creationApi();
    expect(await context.service.prepare(input)).toMatchObject({
      base: "main",
      pushed: true,
      existing: null,
    });
    const link = await context.service.create(input);
    expect(link).toMatchObject({ sessionID: "task", pullRequest: { number: 71 } });
    expect(context.github.rest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: { head: "feature", base: "main", title: "Add feature", body: "Summary", draft: true },
      }),
    );
    expect((await context.service.create(input)).key).toBe(link.key);
    expect(context.github.rest.mock.calls.filter(([call]) => call.method === "POST")).toHaveLength(
      1,
    );
  });

  it("never publishes a branch implicitly and rejects remote connections before network access", async () => {
    creationApi();
    context.git.pullRequestContext.mockResolvedValue({
      branch: "feature",
      base: "main",
      branches: ["main"],
      diff: "diff",
      commits: "commit",
      pushed: false,
    });
    await expect(context.service.create(input)).rejects.toMatchObject({
      code: "branch-not-pushed",
    });
    expect(context.github.rest.mock.calls.some(([call]) => call.method === "POST")).toBe(false);
    context.github.rest.mockClear();
    await expect(
      context.service.create({ ...input, profileID: "remote-profile" }),
    ).rejects.toMatchObject({ code: "unsupported-connection" });
    expect(context.github.rest).not.toHaveBeenCalled();
  });

  it("auto-links only verified repository/current-branch URLs and leaves existing links alone", async () => {
    context.github.pulls.set("acme/web#71", { number: 71, state: "OPEN" });
    await context.service.autoLink(PROFILE, "task", "https://github.com/elsewhere/repo/pull/71");
    expect(context.service.list({ sessionID: "task" })).toHaveLength(0);
    expect(context.github.graphql).not.toHaveBeenCalled();
    context.repositoryOf.mockResolvedValue({
      remote: "git@github.com:Acme/Web.git",
      branch: "other",
    });
    await context.service.autoLink(PROFILE, "task", "https://github.com/acme/web/pull/71");
    expect(context.service.list({ sessionID: "task" })).toHaveLength(0);
    context.repositoryOf.mockResolvedValue({
      remote: "git@github.com:Acme/Web.git",
      branch: "feature",
    });
    await context.service.autoLink(
      PROFILE,
      "task",
      "Created: https://github.com/acme/web/pull/71\n",
    );
    expect(context.service.list({ sessionID: "task" })).toHaveLength(1);
    context.github.graphql.mockClear();
    await context.service.autoLink(PROFILE, "task", "https://github.com/acme/web/pull/72");
    expect(context.github.graphql).not.toHaveBeenCalled();
  });
});

describe("settle on merge", () => {
  async function merge(sessionID: string) {
    context.link(sessionID, 1, "open");
    context.github.pulls.set("acme/web#1", {
      number: 1,
      state: "MERGED",
      mergedAt: new Date(T0).toISOString(),
    });
    context.advance(PULL_REQUEST_SWEEP_INTERVAL_MS);
    await context.service.sweep();
  }

  it("settles the task when its PR merges after the user's last message", async () => {
    await merge("s1");
    expect(context.settles).toEqual([
      { sessionID: "s1", through: { updatedAt: context.now() - 1_000, sessionID: "s1" } },
    ]);
    expect(context.service.list({ profileID: PROFILE })[0]?.settledAt).toBe(context.now());
    expect(context.events).toContainEqual(
      expect.objectContaining({ type: "pull-requests", reason: "settled", sessionIDs: ["s1"] }),
    );
  });

  it("keeps a pinned task", async () => {
    context.triageRecords.set("s1", { disposition: "inbox", pinnedAt: T0 - 5_000 });
    await merge("s1");
    expect(context.settles).toEqual([]);
  });

  it("keeps a task the user wrote to after the merge", async () => {
    context.sessions.activity.lastUserMessageAt = T0 + 1;
    await merge("s1");
    expect(context.settles).toEqual([]);
    // The decision is final for this merge.
    await context.service.sweep();
    expect(context.settles).toEqual([]);
  });

  it("waits for the task's connection before deciding", async () => {
    context.sessions.connected.clear();
    await merge("s1");
    expect(context.settles).toEqual([]);
    context.sessions.connected.add(PROFILE);
    context.advance(PULL_REQUEST_SWEEP_INTERVAL_MS);
    await context.service.sweep();
    expect(context.settles.map((settle) => settle.sessionID)).toEqual(["s1"]);
  });

  it("does not settle a task linked to an already merged PR", async () => {
    context.github.pulls.set("acme/web#9", {
      number: 9,
      state: "MERGED",
      mergedAt: new Date(T0).toISOString(),
    });
    await context.service.link({
      profileID: PROFILE,
      sessionID: "s1",
      url: "https://github.com/acme/web/pull/9",
    });
    await context.service.sweep();
    expect(context.settles).toEqual([]);
  });
});

describe("pull request watch", () => {
  async function watched(pull: Partial<RawPull> = {}) {
    context.link("s1", 1, "open");
    context.github.pulls.set("acme/web#1", {
      number: 1,
      state: "OPEN",
      checks: [{ name: "build", status: "IN_PROGRESS" }],
      ...pull,
    });
    context.service.watch({
      profileID: PROFILE,
      sessionID: "s1",
      key: "github.com/acme/web#1",
      watching: true,
    });
    await context.service.sweep();
    expect(context.sessions.prompts).toEqual([]);
  }

  async function next(pull: Partial<RawPull>) {
    context.github.pulls.set("acme/web#1", {
      ...context.github.pulls.get("acme/web#1")!,
      ...pull,
    });
    context.advance(PULL_REQUEST_SWEEP_INTERVAL_MS);
    await context.service.sweep();
  }

  it("wakes the agent with a queued prompt when a check fails", async () => {
    await watched();
    await next({ checks: [{ name: "build", status: "COMPLETED", conclusion: "FAILURE" }] });
    expect(context.sessions.prompts).toHaveLength(1);
    expect(context.sessions.prompts[0]).toMatchObject({
      sessionID: "s1",
      text: expect.stringContaining("Checks failed on abc1234"),
      metadata: {
        "palot.sourceControl": expect.objectContaining({ changes: ["checks-failed"] }),
      },
    });
    expect(context.service.list()[0]?.watch?.lastWakeAt).toBe(context.now());
  });

  it("wakes when the required checks pass", async () => {
    await watched({
      checks: [
        { name: "build", status: "IN_PROGRESS", required: true },
        { name: "bot", status: "QUEUED" },
      ],
    });
    await next({
      checks: [
        { name: "build", status: "COMPLETED", conclusion: "SUCCESS", required: true },
        { name: "bot", status: "QUEUED" },
      ],
    });
    expect(context.sessions.prompts[0]?.text).toContain("All 1 required check passed");
  });

  it("wakes for another user's comment but not the viewer's own", async () => {
    await watched();
    await next({
      comments: [
        {
          id: "c1",
          author: "me",
          body: "pushed a fix",
          createdAt: new Date(T0 + 30_000).toISOString(),
        },
      ],
    });
    expect(context.sessions.prompts).toEqual([]);
    await next({
      comments: [
        {
          id: "c1",
          author: "me",
          body: "pushed a fix",
          createdAt: new Date(T0 + 30_000).toISOString(),
        },
        {
          id: "c2",
          author: "reviewer",
          body: "Please rename this",
          createdAt: new Date(T0 + 90_000).toISOString(),
        },
      ],
    });
    expect(context.sessions.prompts[0]?.text).toContain('reviewer: "Please rename this"');
  });

  it("wakes when the branch starts to conflict", async () => {
    await watched();
    await next({ mergeable: "CONFLICTING" });
    expect(context.sessions.prompts[0]?.text).toContain("The branch now conflicts with main.");
  });

  it("does not record news it could not deliver", async () => {
    await watched();
    context.sessions.connected.clear();
    await next({ mergeable: "CONFLICTING" });
    expect(context.sessions.prompts).toEqual([]);
    context.sessions.connected.add(PROFILE);
    await next({});
    expect(context.sessions.prompts).toHaveLength(1);
  });

  it("stops after eight failed reads in a row, ignoring rate limits", async () => {
    await watched();
    context.github.fail(new GitHubApiError("rate-limited", "wait", { retryAt: T0 + 1 }));
    for (let index = 0; index < 20; index += 1) await next({});
    expect(context.service.list()[0]?.watch?.readFailures).toBe(0);

    context.github.fail(new GitHubApiError("network", "offline"));
    for (let index = 1; index < PULL_REQUEST_WATCH_READ_FAILURE_LIMIT; index += 1) await next({});
    expect(context.service.list()[0]?.watch?.readFailures).toBe(
      PULL_REQUEST_WATCH_READ_FAILURE_LIMIT - 1,
    );
    await next({});
    const link = context.service.list()[0]!;
    expect(link.watch).toBeNull();
    expect(link.watchEnded?.reason).toBe("unreadable");
    expect(context.sessions.prompts.at(-1)?.text).toContain(
      "failed to read it from GitHub 8 times",
    );
  });

  it("stops after ten comment-only wakes in a row", async () => {
    await watched();
    const comments: NonNullable<RawPull["comments"]> = [];
    for (let index = 1; index <= 10; index += 1) {
      comments.push({
        id: `c${index}`,
        author: "bot",
        body: `note ${index}`,
        createdAt: new Date(T0 + index * 120_000).toISOString(),
      });
      await next({ comments: [...comments] });
    }
    expect(context.sessions.prompts).toHaveLength(10);
    expect(context.service.list()[0]?.watchEnded?.reason).toBe("comment-limit");
  });

  it("stops watching when the PR merges or the task is settled", async () => {
    await watched();
    await next({ state: "MERGED", mergedAt: new Date(T0).toISOString() });
    expect(context.service.list()[0]?.watchEnded?.reason).toBe("merged");

    context.database.$client.close();
    context = await setup();
    await watched();
    context.triageRecords.set("s1", { disposition: "settled", pinnedAt: null });
    await next({ mergeable: "CONFLICTING" });
    expect(context.service.list()[0]?.watchEnded?.reason).toBe("settled");
    expect(context.sessions.prompts).toEqual([]);
  });

  it("refuses to watch a merged PR", () => {
    context.link("s1", 1, "merged");
    expect(() =>
      context.service.watch({
        profileID: PROFILE,
        sessionID: "s1",
        key: "github.com/acme/web#1",
        watching: true,
      }),
    ).toThrow(expect.objectContaining({ code: "pull-request-not-open" }));
  });
});

describe("review findings", () => {
  async function watchedLinks(...numbers: number[]) {
    for (const number of numbers) {
      context.link(`s${number}`, number, "open");
      context.github.pulls.set(`acme/web#${number}`, {
        number,
        state: "OPEN",
        checks: [{ name: "build", status: "IN_PROGRESS" }],
      });
      context.service.watch({
        profileID: PROFILE,
        sessionID: `s${number}`,
        key: `github.com/acme/web#${number}`,
        watching: true,
      });
    }
    await context.service.sweep();
    expect(context.sessions.prompts).toEqual([]);
  }

  function conflictOnNextRead(number = 1) {
    context.github.pulls.set(`acme/web#${number}`, {
      ...context.github.pulls.get(`acme/web#${number}`)!,
      mergeable: "CONFLICTING",
    });
    context.advance(PULL_REQUEST_SWEEP_INTERVAL_MS);
  }

  it("never reads or sends credentials to a persisted host GH_HOST no longer names", async () => {
    context.database.$client.close();
    context = await setup({ GH_HOST: "ghe.b.example" });
    context.link("s1", 1, "open", "ghe.a.example");
    context.advance(PULL_REQUEST_SWEEP_INTERVAL_MS);
    await context.service.sweep();
    expect(context.github.graphqlPartial).not.toHaveBeenCalled();
    expect(context.service.list()[0]?.syncError).toContain("Set GH_HOST=ghe.a.example");
  });

  it("does not wake a watch that was stopped while its read was in flight", async () => {
    await watchedLinks(1);
    conflictOnNextRead();
    context.github.hooks.beforeAnswer = () => {
      context.github.hooks.beforeAnswer = undefined;
      context.service.watch({
        profileID: PROFILE,
        sessionID: "s1",
        key: "github.com/acme/web#1",
        watching: false,
      });
    };
    await context.service.sweep();
    expect(context.sessions.prompts).toEqual([]);
    expect(context.service.list()[0]?.watchEnded?.reason).toBe("stopped");
  });

  it("does not wake with a watch replaced by a new one during the read", async () => {
    await watchedLinks(1);
    conflictOnNextRead();
    context.github.hooks.beforeAnswer = () => {
      context.github.hooks.beforeAnswer = undefined;
      const input = {
        profileID: PROFILE,
        sessionID: "s1",
        key: "github.com/acme/web#1",
      };
      context.service.watch({ ...input, watching: false });
      context.service.watch({ ...input, watching: true });
    };
    await context.service.sweep();
    expect(context.sessions.prompts).toEqual([]);
    // The new watch keeps its own state and records the conflict as its starting point.
    await context.service.sweep();
    expect(context.sessions.prompts).toEqual([]);
    expect(context.service.list()[0]?.watch).not.toBeNull();
  });

  it("does not wake a task unlinked or settled during the read", async () => {
    await watchedLinks(1, 2);
    conflictOnNextRead(1);
    conflictOnNextRead(2);
    context.github.hooks.beforeAnswer = () => {
      context.github.hooks.beforeAnswer = undefined;
      context.service.unlink({ profileID: PROFILE, sessionID: "s1", key: "github.com/acme/web#1" });
      context.triageRecords.set("s2", { disposition: "settled", pinnedAt: null });
    };
    await context.service.sweep();
    expect(context.sessions.prompts).toEqual([]);
    expect(context.service.list().map((link) => [link.sessionID, link.watchEnded?.reason])).toEqual(
      [["s2", "settled"]],
    );
  });

  it("keeps the rest of a batch when one repository is not found", async () => {
    await watchedLinks(1, 2);
    context.github.missing.add("acme/web#2");
    context.advance(PULL_REQUEST_SWEEP_INTERVAL_MS);
    await context.service.sweep();
    const [first, second] = context.service.list();
    expect(first).toMatchObject({ sessionID: "s1", syncError: null });
    expect(first?.watch?.readFailures).toBe(0);
    expect(first?.syncedAt).toBe(context.now());
    expect(second?.syncError).toContain("could not find");
    expect(second?.watch?.readFailures).toBe(1);
  });

  it("does not settle when the user's latest message could not be found", async () => {
    context.sessions.activity.lastUserMessageAt = null;
    context.sessions.activity.complete = false;
    context.link("s1", 1, "open");
    context.github.pulls.set("acme/web#1", {
      number: 1,
      state: "MERGED",
      mergedAt: new Date(T0).toISOString(),
    });
    context.advance(PULL_REQUEST_SWEEP_INTERVAL_MS);
    await context.service.sweep();
    expect(context.settles).toEqual([]);
  });

  it("reports GitHub sign-in per configured host", async () => {
    context.database.$client.close();
    context = await setup({ GH_HOST: "ghe.example.com" });
    context.github.gateway.credential = async (host) => {
      if (host === "github.com") throw new GitHubApiError("credentials", "No credential");
      return { source: "gh", fingerprint: `${host}:fake` };
    };
    const status = await context.facade.status(PROFILE);
    expect(status.github).toMatchObject({ host: "github.com", authenticated: false });
    expect(status.githubHosts?.map((host) => [host.host, host.authenticated, host.login])).toEqual([
      ["github.com", false, null],
      ["ghe.example.com", true, "me"],
    ]);
  });
});
