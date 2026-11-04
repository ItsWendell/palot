import type { ConfigUpdated, VcsBranchUpdated, WorktreeUpdated } from "@opencode/client";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { PalotEvent, PalotEventDeliveryMetadata } from "../../shared";
import { inboxBranchKeys, openCodeKeys } from "./opencode-query";
import {
  markShutdownLocationStale,
  openCodeInvalidationKeys,
  sessionStatsShouldRevalidate,
} from "./opencode-query-events";

describe("OpenCode query event routing", () => {
  it("invalidates only the session whose metadata changed", async () => {
    const client = new QueryClient();
    const target = openCodeKeys.session("connection-a", "session");
    const otherSession = openCodeKeys.session("connection-a", "other");
    const otherConnection = openCodeKeys.session("connection-b", "session");
    for (const key of [target, otherSession, otherConnection]) client.setQueryData(key, {});
    const event = {
      id: "metadata",
      created: 2,
      createdAt: 2,
      receiveSequence: 1,
      type: "session.metadata.updated",
      durable: { aggregateID: "session", seq: 2, version: 1 },
      data: { sessionID: "session", metadata: { label: "new" } },
    } satisfies PalotEvent;
    for (const queryKey of openCodeInvalidationKeys("connection-a", event)) {
      await client.invalidateQueries({ queryKey });
    }
    expect(client.getQueryState(target)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherSession)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherConnection)?.isInvalidated).toBe(false);
    client.clear();
  });

  it.each(["provider.updated", "model.updated"] as const)(
    "invalidates model and settings inventories after %s",
    (type) => {
      const location = { directory: "/repo" };
      expect(
        openCodeInvalidationKeys("connection", { type, location, data: {} } as PalotEvent),
      ).toEqual([
        openCodeKeys.modelsLocation("connection", location),
        openCodeKeys.settingsLocation("connection", location),
      ]);
    },
  );

  it("only marks an evicted location's own reads stale, without re-reading anything", async () => {
    const client = new QueryClient();
    const repo = { directory: "/repo", workspaceID: "wt" };
    const queryFn = vi.fn(async () => ({}));
    const keys = {
      catalog: openCodeKeys.composerCatalog("connection", repo),
      vcs: openCodeKeys.vcsLocation("connection", repo),
      shells: openCodeKeys.runningShells("connection", repo),
      usage: openCodeKeys.usageLimits("connection", "/repo"),
      finished: [...openCodeKeys.all("connection"), "session-process-finished", repo, "shell"],
      other: openCodeKeys.composerCatalog("connection", { directory: "/other" }),
      settings: openCodeKeys.settings("connection"),
      session: openCodeKeys.session("connection", "session"),
      otherServer: openCodeKeys.composerCatalog("other", repo),
    };
    const observers = Object.values(keys).map((queryKey) => {
      client.setQueryData(queryKey, {});
      const observer = new QueryObserver(client, { queryKey, queryFn, staleTime: Infinity });
      return observer.subscribe(() => undefined);
    });
    client.setQueryData(openCodeKeys.loadedLocations("connection"), ["/repo", "/other"]);
    client.setQueryData(inboxBranchKeys.location("connection", repo), {});
    expect(
      openCodeInvalidationKeys("connection", {
        type: "location.shutdown",
        location: repo,
        data: {},
      } as PalotEvent),
    ).toEqual([]);
    markShutdownLocationStale(client, "connection", "/repo");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryFn).not.toHaveBeenCalled();
    for (const key of [keys.catalog, keys.vcs, keys.shells, keys.usage, keys.finished])
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of [keys.other, keys.settings, keys.session, keys.otherServer])
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(client.getQueryData(openCodeKeys.loadedLocations("connection"))).toEqual(["/other"]);
    expect(client.getQueryData(inboxBranchKeys.location("connection", repo))).toBeUndefined();
    observers.forEach((unsubscribe) => unsubscribe());
    client.clear();
  });

  it.each(["filesystem.changed", "vcs.branch.updated"])(
    "keeps other checkouts' branch caches fresh after a scoped %s",
    async (type) => {
      const client = new QueryClient();
      const location = { directory: "/repo", workspaceID: "worktree-a" };
      const target = openCodeKeys.vcsLocation("connection", location);
      const other = openCodeKeys.vcsLocation("connection", {
        directory: "/other",
        workspaceID: "worktree-b",
      });
      client.setQueryData(target, { currentBranch: "feature-a" });
      client.setQueryData(other, { currentBranch: "feature-b" });
      for (const queryKey of openCodeInvalidationKeys("connection", {
        type,
        location,
        data: {},
      } as PalotEvent)) {
        await client.invalidateQueries({ queryKey });
      }
      expect(client.getQueryState(target)?.isInvalidated).toBe(true);
      expect(client.getQueryState(other)?.isInvalidated).toBe(false);
      client.clear();
    },
  );

  it("refreshes all branch caches when filesystem scope is unavailable", async () => {
    const client = new QueryClient();
    const keys = ["/repo", "/other"].map((directory) =>
      openCodeKeys.vcsLocation("connection", { directory }),
    );
    for (const key of keys) client.setQueryData(key, { currentBranch: "main" });
    for (const queryKey of openCodeInvalidationKeys("connection", {
      type: "filesystem.changed",
      data: {},
    } as PalotEvent)) {
      await client.invalidateQueries({ queryKey });
    }
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.clear();
  });
  it("refreshes a watched directory's files under any workspace ID", async () => {
    const client = new QueryClient();
    const watched = openCodeKeys.file("connection", { directory: "/repo", workspaceID: "wt" }, "a");
    const other = openCodeKeys.file("connection", { directory: "/other" }, "a");
    for (const key of [watched, other]) client.setQueryData(key, "text");
    for (const queryKey of openCodeInvalidationKeys("connection", {
      type: "filesystem.changed",
      location: { directory: "/repo" },
      data: {},
    } as PalotEvent)) {
      await client.invalidateQueries({ queryKey });
    }
    expect(client.getQueryState(watched)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  });
  it.each(["session.inbox.cancelled", "session.revert.committed"])(
    "invalidates only the affected prompt index after %s",
    async (type) => {
      const client = new QueryClient();
      const target = openCodeKeys.promptIndex("connection-a", "session");
      const otherSession = openCodeKeys.promptIndex("connection-a", "other");
      const otherConnection = openCodeKeys.promptIndex("connection-b", "session");
      for (const key of [target, otherSession, otherConnection]) client.setQueryData(key, {});
      const event = { type, data: { sessionID: "session" } } as PalotEvent;
      for (const queryKey of openCodeInvalidationKeys("connection-a", event)) {
        await client.invalidateQueries({ queryKey });
      }
      expect(client.getQueryState(target)?.isInvalidated).toBe(true);
      expect(client.getQueryState(otherSession)?.isInvalidated).toBe(false);
      expect(client.getQueryState(otherConnection)?.isInvalidated).toBe(false);
      client.clear();
    },
  );
  it("targets the batch connection and event location", () => {
    const event: VcsBranchUpdated & PalotEventDeliveryMetadata & { createdAt: number } = {
      id: "vcs",
      created: 1,
      createdAt: 1,
      receiveSequence: 1,
      type: "vcs.branch.updated",
      location: { directory: "/repo", workspaceID: "worktree" },
      data: { branch: "feature" },
    };

    expect(openCodeInvalidationKeys("connection-a", event)).toEqual([
      openCodeKeys.vcsLocation("connection-a", event.location!),
      openCodeKeys.diffsLocation("connection-a", event.location!),
      openCodeKeys.vcsBranches("connection-a", event.location!),
    ]);
  });

  it("targets one project worktree cache", () => {
    const event: WorktreeUpdated & PalotEventDeliveryMetadata & { createdAt: number } = {
      id: "worktree",
      created: 1,
      createdAt: 1,
      receiveSequence: 1,
      type: "worktree.updated",
      data: { projectID: "project-1" },
    };

    expect(openCodeInvalidationKeys("connection-b", event)).toEqual([
      openCodeKeys.worktrees("connection-b", "project-1"),
      openCodeKeys.projects("connection-b"),
    ]);
  });

  it("invalidates inferred review bases with the affected VCS location", async () => {
    const client = new QueryClient();
    const location = { directory: "/repo", workspaceID: "worktree" };
    const target = openCodeKeys.vcsBase("connection-a", location);
    const other = openCodeKeys.vcsBase("connection-a", { directory: "/other" });
    client.setQueryData(target, { ref: "refs/heads/main" });
    client.setQueryData(other, { ref: "refs/heads/release" });
    const event = {
      id: "branch",
      created: 1,
      createdAt: 1,
      receiveSequence: 1,
      type: "vcs.branch.updated",
      location,
      data: { branch: "topic" },
    } as PalotEvent;
    for (const queryKey of openCodeInvalidationKeys("connection-a", event)) {
      await client.invalidateQueries({ queryKey });
    }
    expect(client.getQueryState(target)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  });

  it("invalidates a location-scoped settings snapshot", () => {
    const event: ConfigUpdated & PalotEventDeliveryMetadata & { createdAt: number } = {
      id: "config",
      created: 1,
      createdAt: 1,
      receiveSequence: 1,
      type: "config.updated",
      location: { directory: "/repo", workspaceID: "worktree" },
      data: {},
    };

    expect(openCodeInvalidationKeys("connection-c", event)).toEqual([
      openCodeKeys.settingsLocation("connection-c", event.location!),
      openCodeKeys.composerCatalog("connection-c", event.location!),
    ]);
  });

  it("refreshes forked session catalogs and transcript state", () => {
    const event = {
      id: "forked",
      created: 1,
      createdAt: 1,
      receiveSequence: 1,
      type: "session.forked",
      data: {
        sessionID: "child",
        parentID: "parent",
        boundary: { type: "through", messageID: "message" },
      },
    } as PalotEvent;

    expect(openCodeInvalidationKeys("connection-d", event)).toEqual([
      openCodeKeys.childSessions("connection-d", "parent"),
      openCodeKeys.session("connection-d", "child"),
      openCodeKeys.transcript("connection-d", "child"),
      openCodeKeys.sessionActivity("connection-d"),
    ]);
  });

  it("refreshes web-search inventory only in the affected connection and location", () => {
    const event = {
      id: "search-providers",
      created: 1,
      createdAt: 1,
      receiveSequence: 1,
      type: "websearch.updated",
      location: { directory: "/repo", workspaceID: "worktree" },
      data: {},
    } satisfies PalotEvent;

    expect(openCodeInvalidationKeys("connection-search", event)).toEqual([
      openCodeKeys.settingsLocation("connection-search", event.location!),
    ]);
    expect(
      openCodeInvalidationKeys("connection-search", { ...event, location: undefined }),
    ).toEqual([openCodeKeys.settings("connection-search")]);
  });

  it("refreshes artifact lists in the location whose providers changed", async () => {
    const client = new QueryClient();
    const repo = openCodeKeys.artifactsLocation("connection", "/repo");
    const other = openCodeKeys.artifactsLocation("connection", "/other");
    const remote = openCodeKeys.artifactsLocation("connection-b", "/repo");
    for (const key of [repo, other, remote]) client.setQueryData(key, []);
    const event = {
      id: "artifact-providers",
      created: 1,
      createdAt: 1,
      receiveSequence: 1,
      type: "artifact.updated",
      location: { directory: "/repo" },
      data: {},
    } satisfies PalotEvent;
    for (const queryKey of openCodeInvalidationKeys("connection", event))
      await client.invalidateQueries({ queryKey });
    expect(client.getQueryState(repo)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    expect(client.getQueryState(remote)?.isInvalidated).toBe(false);
    for (const queryKey of openCodeInvalidationKeys("connection", {
      ...event,
      location: undefined,
    }))
      await client.invalidateQueries({ queryKey });
    expect(client.getQueryState(other)?.isInvalidated).toBe(true);
    expect(client.getQueryState(remote)?.isInvalidated).toBe(false);
    client.clear();
  });

  it("refreshes running shells for global shell lifecycle events", () => {
    const event = {
      id: "shell",
      created: 1,
      createdAt: 1,
      receiveSequence: 1,
      type: "shell.exited",
      location: { directory: "/repo" },
      data: { id: "shell-1", status: "exited" },
    } as PalotEvent;

    // Any workspace under the directory.
    expect(openCodeInvalidationKeys("connection-e", event)).toEqual([
      [...openCodeKeys.runningShellsRoot("connection-e"), "/repo"],
    ]);
  });

  it("invalidates MCP settings after status and resource events", () => {
    const event = {
      id: "mcp",
      created: 1,
      createdAt: 1,
      receiveSequence: 1,
      type: "mcp.resources.changed",
      location: { directory: "/repo" },
      data: { server: "docs" },
    } as PalotEvent;

    expect(openCodeInvalidationKeys("connection-f", event)).toEqual([
      openCodeKeys.settingsLocation("connection-f", event.location!),
    ]);
  });

  it("refreshes settings and model catalogs when the active credential changes", () => {
    const event = {
      id: "credential",
      created: 1,
      createdAt: 1,
      receiveSequence: 1,
      type: "credential.switched",
      location: { directory: "/repo" },
      data: { integrationID: "anthropic", credentialID: "credential-1" },
    } as PalotEvent;

    expect(openCodeInvalidationKeys("connection-g", event)).toEqual([
      openCodeKeys.modelsLocation("connection-g", event.location!),
      openCodeKeys.settingsLocation("connection-g", event.location!),
    ]);
  });

  it("refreshes the project catalog after project metadata changes", () => {
    const event = {
      id: "project",
      created: 1,
      createdAt: 1,
      receiveSequence: 1,
      type: "project.updated",
      data: {
        id: "project-1",
        canonical: "/repo",
        sandboxes: [],
        time: { created: 1, updated: 1, active: 1 },
      },
    } as PalotEvent;

    expect(openCodeInvalidationKeys("connection-h", event)).toEqual([
      openCodeKeys.projects("connection-h"),
    ]);
  });

  it("marks only durable session lifecycle changes as usage changes", () => {
    const lifecycle = {
      id: "complete",
      created: 1,
      createdAt: 1,
      receiveSequence: 1,
      type: "session.execution.succeeded",
      data: { sessionID: "session-1" },
    } as PalotEvent;
    const streaming = {
      ...lifecycle,
      id: "delta",
      type: "session.text.delta",
      data: { sessionID: "session-1", assistantMessageID: "message-1", ordinal: 1, delta: "x" },
    } as PalotEvent;

    expect(sessionStatsShouldRevalidate(lifecycle)).toBe(true);
    expect(sessionStatsShouldRevalidate(streaming)).toBe(false);
  });
});
