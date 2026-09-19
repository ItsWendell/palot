import type { OpenCodeClient, PermissionRuleset, SessionInfo } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotApi } from "../../shared";
import {
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
  setFocusedOpenCodeRuntime,
} from "./opencode-client";
import { palot } from "./palot";

const connectedRuntime: OpenCodeRuntimeStatus = {
  connectionID: "test",
  profileID: "test-profile",
  contractVersion: "2.0.7",
  phase: "connected",
  connected: true,
  binaryPath: "/usr/local/bin/opencode",
  version: "2.0.7",
  pid: 42,
  managed: false,
  lastConnectedAt: 1,
  error: null,
  versionMismatch: null,
};

const session: SessionInfo = {
  id: "session-1",
  projectID: "project-1",
  cost: 0,
  location: { directory: "/repo" },
  time: { created: 1, updated: 1 },
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

function bridge(overrides: Record<string, unknown> = {}): PalotApi {
  return {
    runtimeStatus: vi.fn().mockResolvedValue(connectedRuntime),
    connectOpenCode: vi.fn().mockResolvedValue(connectedRuntime),
    ...overrides,
  } as unknown as PalotApi;
}

function client(overrides: Record<string, unknown> = {}): OpenCodeClient {
  return {
    project: { list: vi.fn().mockResolvedValue([]) },
    session: {
      list: vi.fn().mockResolvedValue({ data: [], cursor: {} }),
      active: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue(session),
    },
    ...overrides,
  } as unknown as OpenCodeClient;
}

afterEach(() => {
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
  window.history.replaceState({}, "", "/");
});

describe("palot over the official OpenCode client", () => {
  it.each(
    (
      [
        [],
        [{ action: "*", resource: "*", effect: "allow" }],
        [{ action: "shell", resource: "git *", effect: "ask" }],
      ] satisfies PermissionRuleset[]
    ).map((permissions) => ({ permissions })),
  )(
    "creates a session with its permissions before any prompt: $permissions",
    async ({ permissions }) => {
      const create = vi.fn().mockResolvedValue({ ...session, permissions });
      setOpenCodeClientForTest(client({ session: { create } }));
      Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

      await expect(
        palot.createSession("/repo", "workspace", undefined, permissions),
      ).resolves.toMatchObject({ permissions });
      expect(create).toHaveBeenCalledExactlyOnceWith({
        location: { directory: "/repo", workspaceID: "workspace" },
        permissions,
      });
    },
  );

  it("awaits the permission rules ACK without reading or answering pending requests", async () => {
    const ack = Promise.withResolvers<void>();
    const rules = vi.fn().mockReturnValue(ack.promise);
    const reply = vi.fn();
    const get = vi.fn();
    setOpenCodeClientForTest(client({ permission: { reply }, session: { get, update: rules } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });
    const input = { sessionID: session.id, permissions: [] };
    const settled = vi.fn();
    const pending = palot.setSessionPermissions(input).then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(rules).toHaveBeenCalledExactlyOnceWith(input, { signal: expect.any(AbortSignal) });
    ack.resolve();
    await pending;
    expect(settled).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("propagates permission update failures", async () => {
    const rules = vi.fn().mockRejectedValue(new Error("Permission update failed"));
    setOpenCodeClientForTest(client({ session: { update: rules } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });
    await expect(
      palot.setSessionPermissions({ sessionID: session.id, permissions: [] }),
    ).rejects.toThrow("Permission update failed");
  });

  it("creates a session on an explicit connection instead of the newly focused owner", async () => {
    setFocusedOpenCodeRuntime(connectedRuntime);
    setFocusedOpenCodeRuntime({
      ...connectedRuntime,
      connectionID: "other",
      profileID: "other-profile",
    });
    const request = vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(JSON.stringify({ data: session })).buffer,
    });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({ openCodeRequest: request }),
    });

    await expect(
      palot.createSession("/repo", undefined, connectedRuntime.connectionID),
    ).resolves.toMatchObject({ id: session.id });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionID: connectedRuntime.connectionID,
        profileID: connectedRuntime.profileID,
        method: "POST",
      }),
    );
  });

  it("updates permission rules on the captured connection even when another owner is focused", async () => {
    setFocusedOpenCodeRuntime(connectedRuntime);
    setFocusedOpenCodeRuntime({
      ...connectedRuntime,
      connectionID: "other",
      profileID: "other-profile",
    });
    const request = vi.fn().mockResolvedValue({
      status: 204,
      statusText: "No Content",
      headers: {},
      body: new ArrayBuffer(0),
    });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({ openCodeRequest: request }),
    });
    const permissions: PermissionRuleset = [{ action: "*", resource: "*", effect: "allow" }];
    await palot.setSessionPermissions(
      { sessionID: session.id, permissions },
      connectedRuntime.connectionID,
    );
    expect(request).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        connectionID: connectedRuntime.connectionID,
        profileID: connectedRuntime.profileID,
        method: "PATCH",
      }),
    );
  });

  it.each(["move", "stage", "clear", "commit"] as const)(
    "keeps the %s follow-up read on the mutation's original client",
    async (operation) => {
      const mutation = Promise.withResolvers<void>();
      const mutate = vi.fn().mockReturnValue(mutation.promise);
      const get = vi.fn().mockResolvedValue(session);
      setOpenCodeClientForTest(
        client({
          session: { get, move: mutate, revert: { stage: mutate, clear: mutate, commit: mutate } },
        }),
      );
      Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

      const pending =
        operation === "move"
          ? palot.moveSession(session.id, "/new-worktree")
          : operation === "stage"
            ? palot.stageSessionRevert({ sessionID: session.id, messageID: "message-1" })
            : operation === "clear"
              ? palot.clearSessionRevert(session.id)
              : palot.commitSessionRevert(session.id);
      const otherGet = vi.fn().mockRejectedValue(new Error("Wrong owner"));
      setOpenCodeClientForTest(client({ session: { get: otherGet } }));
      mutation.resolve();

      await expect(pending).resolves.toMatchObject({ id: session.id });
      expect(get).toHaveBeenCalledWith(
        { sessionID: session.id },
        { signal: expect.any(AbortSignal) },
      );
      expect(otherGet).not.toHaveBeenCalled();
    },
  );

  it("captures the import client before awaiting file and directory dialogs", async () => {
    const file = Promise.withResolvers<{ contents: string }>();
    const directory = Promise.withResolvers<string>();
    const importSession = vi.fn().mockResolvedValue(session);
    const otherImport = vi.fn().mockRejectedValue(new Error("Wrong owner"));
    const pickDirectory = vi.fn().mockReturnValue(directory.promise);
    setOpenCodeClientForTest(client({ session: { import: importSession } }));
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({ pickSessionImport: () => file.promise, pickDirectory }),
    });

    const pending = palot.importSession();
    setOpenCodeClientForTest(client({ session: { import: otherImport } }));
    file.resolve({ contents: JSON.stringify({ info: session, messages: [] }) });
    await vi.waitFor(() => expect(pickDirectory).toHaveBeenCalledOnce());
    directory.resolve("/repo");

    await expect(pending).resolves.toMatchObject({ id: session.id });
    expect(importSession).toHaveBeenCalledOnce();
    expect(otherImport).not.toHaveBeenCalled();
  });

  it("forwards the branch review base to the official diff request, not working diffs", async () => {
    const diff = vi.fn().mockResolvedValue({ data: [] });
    setOpenCodeClientForTest(client({ vcs: { diff } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });
    await palot.listDiffs({
      directory: "/repo",
      workspaceID: "tree",
      mode: "branch",
      base: "refs/heads/release",
      context: 3,
    });
    expect(diff).toHaveBeenLastCalledWith(
      {
        location: { directory: "/repo", workspace: "tree" },
        mode: "branch",
        base: "refs/heads/release",
        context: 3,
      },
      expect.any(Object),
    );
    await palot.listDiffs({ directory: "/repo", mode: "working", base: "ignored" });
    expect(diff).toHaveBeenLastCalledWith(
      { location: { directory: "/repo" }, mode: "working" },
      expect.any(Object),
    );
  });

  it("waits for official execution cleanup before resolving idle", async () => {
    const idle = Promise.withResolvers<void>();
    const wait = vi.fn().mockReturnValue(idle.promise);
    setOpenCodeClientForTest(client({ session: { wait } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    const settled = vi.fn();
    const pending = palot.waitForSessionIdle(session.id).then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(wait).toHaveBeenCalledWith(
      { sessionID: session.id },
      { signal: expect.any(AbortSignal) },
    );
    idle.resolve();
    await pending;
    expect(settled).toHaveBeenCalledOnce();
  });

  it("propagates cleanup failures instead of treating the session as idle", async () => {
    const wait = vi.fn().mockRejectedValue(new Error("Cleanup timed out"));
    setOpenCodeClientForTest(client({ session: { wait } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await expect(palot.waitForSessionIdle(session.id)).rejects.toThrow("Cleanup timed out");
  });

  it("does not expose a speculative message cursor for a short terminal page", async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        {
          id: "message-1",
          type: "user",
          text: "Hello",
          time: { created: 1 },
        },
      ],
      cursor: { next: "speculative-older" },
    });
    setOpenCodeClientForTest(client({ message: { list } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    const result = await palot.loadTranscript({
      id: session.id,
      parentID: null,
      projectID: session.projectID,
      title: null,
      agent: null,
      model: null,
      location: session.location,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      cost: null,
      tokens: session.tokens,
    });

    expect(result.cursor.next).toBeNull();
    expect(result.data[0]).toEqual({
      id: "message-1",
      type: "user",
      text: "Hello",
      time: { created: 1 },
    });
    expect(result.data[0]).not.toHaveProperty("createdAt");
    expect(list).toHaveBeenCalledWith(
      { sessionID: session.id, limit: 20, order: "desc" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not expose a speculative message cursor for a full terminal page", async () => {
    const data = Array.from({ length: 20 }, (_, index) => ({
      id: `message-${index}`,
      type: "user" as const,
      text: `Message ${index}`,
      time: { created: index + 1 },
    }));
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data, cursor: { next: "speculative-older" } })
      .mockResolvedValueOnce({ data: [], cursor: {} });
    setOpenCodeClientForTest(client({ message: { list } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    const result = await palot.loadTranscript({
      id: session.id,
      parentID: null,
      projectID: session.projectID,
      title: null,
      agent: null,
      model: null,
      location: session.location,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      cost: null,
      tokens: session.tokens,
    });

    expect(result.cursor.next).toBeNull();
    expect(list).toHaveBeenNthCalledWith(
      2,
      { sessionID: session.id, cursor: "speculative-older", limit: 1 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("keeps a full-page cursor when the probe finds an older message", async () => {
    const data = Array.from({ length: 20 }, (_, index) => ({
      id: `message-${index}`,
      type: "user" as const,
      text: `Message ${index}`,
      time: { created: index + 1 },
    }));
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data, cursor: { next: "older" } })
      .mockResolvedValueOnce({
        data: [{ id: "older-message", type: "user", text: "Older", time: { created: 0 } }],
        cursor: { next: "terminal" },
      });
    setOpenCodeClientForTest(client({ message: { list } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    const result = await palot.loadTranscript({
      id: session.id,
      parentID: null,
      projectID: session.projectID,
      title: null,
      agent: null,
      model: null,
      location: session.location,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      cost: null,
      tokens: session.tokens,
    });

    expect(result.cursor.next).toBe("older");
  });

  it("loads older messages in bounded pages", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], cursor: {} });
    setOpenCodeClientForTest(client({ message: { list } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await palot.loadOlder(session.id, "older");

    expect(list).toHaveBeenCalledWith(
      { sessionID: session.id, cursor: "older", limit: 100 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("awaits configuration reload on its captured owner and propagates failure", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ location: { reload } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });
    await palot.reloadConfiguration("connection");
    expect(reload).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
    reload.mockRejectedValueOnce(new Error("Could not load configuration"));
    await expect(palot.reloadConfiguration("connection")).rejects.toThrow(
      "Could not load configuration",
    );
  });

  it("renames a session through client.session.update", async () => {
    const rename = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ session: { update: rename } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await palot.renameSession("session-1", "Renamed task");

    expect(rename).toHaveBeenCalledWith({ sessionID: "session-1", title: "Renamed task" });
  });

  it("moves a session through client.session.move and returns its new location", async () => {
    const moved = { ...session, location: { directory: "/worktree/new" } };
    const move = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue(moved);
    setOpenCodeClientForTest(client({ session: { move, get } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await expect(palot.moveSession("session-1", "/worktree/new")).resolves.toEqual(
      expect.objectContaining({ id: "session-1", location: { directory: "/worktree/new" } }),
    );

    expect(move).toHaveBeenCalledWith({ sessionID: "session-1", directory: "/worktree/new" });
    expect(get).toHaveBeenCalledWith(
      { sessionID: "session-1" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("forks a full session or stops before the next user message", async () => {
    const fork = vi.fn().mockResolvedValue({ ...session, id: "session-fork" });
    setOpenCodeClientForTest(client({ session: { fork } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await palot.forkSession({ sessionID: session.id });
    await palot.forkSession({ sessionID: session.id, beforeMessageID: "next-user" });

    expect(fork).toHaveBeenNthCalledWith(1, {
      sessionID: session.id,
    });
    expect(fork).toHaveBeenNthCalledWith(2, {
      sessionID: session.id,
      before: "next-user",
    });
  });

  it("continues blocking session tools in the background", async () => {
    const background = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ session: { background } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await palot.backgroundSession(session.id);

    expect(background).toHaveBeenCalledWith({ sessionID: session.id });
  });

  it("creates worktrees using the source location and server-owned defaults", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ directory: "/data/opencode/worktree/projec/quiet-river" });
    const get = vi.fn().mockResolvedValue({ project: { id: "project-1" } });
    setOpenCodeClientForTest(client({ worktree: { create }, location: { get } }));
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge(),
    });

    await expect(palot.createProjectCopy("project-1", "/repo")).resolves.toEqual({
      directory: "/data/opencode/worktree/projec/quiet-river",
    });

    expect(create).toHaveBeenCalledWith(
      {
        projectID: "project-1",
        from: "/repo",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(
      2,
      { location: { directory: "/data/opencode/worktree/projec/quiet-river" } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("lets the server resolve a nested source even when the cached project is global", async () => {
    const create = vi.fn().mockResolvedValue({ directory: "/data/worktrees/repo/quiet-river" });
    const get = vi.fn().mockResolvedValue({ project: { id: "discovered-project" } });
    const list = vi.fn();
    setOpenCodeClientForTest(
      client({ worktree: { create }, location: { get }, project: { list } }),
    );
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge(),
    });

    await palot.createProjectCopy("global", "/repo/nested", "release");

    expect(list).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      { projectID: "discovered-project", from: "/repo/nested", branch: "release" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("includes the primary project directory when listing move targets", async () => {
    const list = vi.fn().mockResolvedValue([
      { directory: "/worktree/one", strategy: "git" },
      { directory: "/repo", strategy: undefined },
    ]);
    setOpenCodeClientForTest(client({ worktree: { list } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await expect(palot.listProjectDirectories("project-1", "/repo")).resolves.toEqual([
      { directory: "/repo", strategy: null },
      { directory: "/worktree/one", strategy: "git" },
    ]);
    expect(list).toHaveBeenCalledWith(
      { projectID: "project-1" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("refreshes and removes copies in the source location without removing the main checkout", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ worktree: { refresh, remove } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await palot.refreshProjectCopies("project-1", "/repo");
    await palot.removeProjectCopy("project-1", "/repo", "/copies/dirty", true);
    await expect(palot.removeProjectCopy("project-1", "/repo", "/repo", true)).rejects.toThrow(
      "The main checkout cannot be removed",
    );

    expect(refresh).toHaveBeenCalledWith(
      { projectID: "project-1" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(remove).toHaveBeenCalledExactlyOnceWith(
      { projectID: "project-1", directory: "/copies/dirty", force: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("blocks primary checkout removal before contacting OpenCode", async () => {
    const remove = vi.fn();
    setOpenCodeClientForTest(client({ worktree: { remove } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });
    await expect(palot.removeProjectCopy("project-1", "/repo", "/repo", true)).rejects.toThrow(
      "The main checkout cannot be removed",
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("delivers binary server paths in prompt and command text instead of silently dropping attachments", async () => {
    const prompt = vi.fn().mockResolvedValue({
      id: "input",
      sessionID: "session-1",
      type: "user",
      delivery: null,
      time: { created: 1 },
    });
    const command = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ session: { prompt, command } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });
    const files = [
      {
        uri: "file:///server/uploads/archive.zip",
        name: "archive.zip",
        mime: "application/zip",
        size: 20,
      },
    ];
    await palot.sendComposerPrompt({ sessionID: "session-1", text: "Inspect", files });
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Inspect\nAttached file: "/server/uploads/archive.zip"',
        metadata: expect.objectContaining({
          displayText: "Inspect",
          attachments: [expect.objectContaining({ name: "archive.zip" })],
        }),
      }),
      expect.anything(),
    );
    await palot.runCommand({ sessionID: "session-1", command: "review", files });
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "review",
        text: '/review\nAttached file: "/server/uploads/archive.zip"',
      }),
      expect.anything(),
    );
  });

  it("sends picked text paths without shifting skill mentions or losing display metadata", async () => {
    const prompt = vi.fn().mockResolvedValue({
      id: "message-1",
      sessionID: "session-1",
      type: "user",
      delivery: "queue",
      time: { created: 10 },
    });
    setOpenCodeClientForTest(client({ session: { prompt } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await expect(
      palot.sendComposerPrompt({
        sessionID: "session-1",
        id: "msg_client",
        text: "Review this $skill-1",
        files: [{ uri: "file:///tmp/example.ts", name: "example.ts", mime: "text/plain", size: 5 }],
        skillReferences: [
          {
            id: "skill-1",
            mention: { start: 12, end: 20, text: "$skill-1" },
            text: "Pinned skill content",
          },
        ],
        delivery: "queue",
      }),
    ).resolves.toEqual({
      id: "message-1",
      sessionID: "session-1",
      type: "user",
      delivery: "queue",
      createdAt: 10,
    });
    expect(prompt).toHaveBeenCalledWith(
      {
        sessionID: "session-1",
        id: "msg_client",
        text: 'Review this $skill-1\nAttached file: "/tmp/example.ts"',
        metadata: {
          displayText: "Review this $skill-1",
          comments: [],
          attachments: [
            {
              uri: "file:///tmp/example.ts",
              path: "/tmp/example.ts",
              name: "example.ts",
              mime: "text/plain",
              size: 5,
            },
          ],
          palotAttachmentPaths: true,
        },
        skills: [
          {
            id: "skill-1",
            mention: { start: 12, end: 20, text: "$skill-1" },
            text: "Pinned skill content",
          },
        ],
        delivery: "queue",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("runs commands with the beta text payload and no receipt", async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ session: { command } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await expect(
      palot.runCommand({
        sessionID: "session-1",
        command: "review",
        arguments: "auth",
        skillReferences: [
          {
            id: "skill-1",
            mention: { start: 13, end: 21, text: "$skill-1" },
            text: "Pinned skill content",
          },
        ],
        delivery: "queue",
      }),
    ).resolves.toBeUndefined();

    expect(command).toHaveBeenCalledWith(
      {
        sessionID: "session-1",
        name: "review",
        text: "/review auth",
        skills: [
          {
            id: "skill-1",
            mention: { start: 13, end: 21, text: "$skill-1" },
            text: "Pinned skill content",
          },
        ],
        delivery: "queue",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("switches agents and removes sessions through the current contract", async () => {
    const switchAgent = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ session: { switchAgent, remove } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await palot.switchAgent({ sessionID: "session-1", agent: "build" });
    await palot.removeSession("session-1");

    expect(switchAgent).toHaveBeenCalledWith({ sessionID: "session-1", agent: "build" });
    expect(remove).toHaveBeenCalledWith({ sessionID: "session-1" });
  });

  it("exports the original task text through the native save dialog", async () => {
    const messages = [
      { id: "user-1", type: "user", time: { created: 1 }, text: "Keep the original question" },
    ];
    const transfer = { info: { ...session, parentID: "parent-session" }, messages };
    const exportSession = vi.fn().mockResolvedValue(transfer);
    const saveSessionExport = vi.fn().mockResolvedValue("/tmp/Task.palot-task.json");
    setOpenCodeClientForTest(client({ session: { export: exportSession } }));
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({ saveSessionExport }),
    });

    await expect(palot.exportSession("session-1", "Task")).resolves.toBe(
      "/tmp/Task.palot-task.json",
    );
    expect(exportSession).toHaveBeenCalledWith(
      { sessionID: "session-1", sanitize: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(saveSessionExport).toHaveBeenCalledWith({
      suggestedName: "Task.palot-task.json",
      contents: `${JSON.stringify({ info: session, messages }, null, 2)}\n`,
    });
  });

  it("copies the original title and conversation text as Markdown", async () => {
    const transfer = {
      info: { ...session, title: "Task" },
      messages: [{ id: "user-1", type: "user", time: { created: 1 }, text: "Hello" }],
    };
    const exportSession = vi.fn().mockResolvedValue(transfer);
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ session: { export: exportSession } }));
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({ writeClipboardText }),
    });

    await palot.copySessionMarkdown("session-1");

    expect(exportSession).toHaveBeenCalledWith(
      { sessionID: "session-1", sanitize: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(writeClipboardText).toHaveBeenCalledWith(
      "# Task\n\nTask ID: session-1\n\n## You\n\nHello\n",
    );
  });

  it("does not report a copied conversation when export fails", async () => {
    const exportSession = vi.fn().mockRejectedValue(new Error("Export failed"));
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ session: { export: exportSession } }));
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({ writeClipboardText }),
    });

    await expect(palot.copySessionMarkdown("session-1")).rejects.toThrow("Export failed");
    expect(writeClipboardText).not.toHaveBeenCalled();
  });

  it("imports a task selected through the native open dialog", async () => {
    const imported = { ...session, id: "session-imported" };
    const importSession = vi.fn().mockResolvedValue(imported);
    const transfer = { info: { ...session, parentID: "missing-parent" }, messages: [] };
    setOpenCodeClientForTest(client({ session: { import: importSession } }));
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({
        pickSessionImport: vi.fn().mockResolvedValue({
          path: "/tmp/task.json",
          contents: JSON.stringify(transfer),
        }),
      }),
    });

    await expect(palot.importSession({ directory: "/repo" })).resolves.toMatchObject({
      id: "session-imported",
    });
    expect(importSession).toHaveBeenCalledWith(
      {
        ...transfer,
        info: { ...transfer.info, parentID: undefined },
        location: { directory: "/repo" },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("encodes form answers by the authoritative server field shape", async () => {
    const get = vi.fn().mockResolvedValue({
      fields: [
        { key: "summary", type: "text" },
        { key: "files", type: "multiselect" },
      ],
    });
    const reply = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ session: { form: { get, reply } } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await palot.replyQuestion({
      sessionID: "session-1",
      requestID: "form-1",
      answers: [["Ship it"], ["one.ts", "two.ts"]],
    });

    expect(reply).toHaveBeenCalledWith({
      sessionID: "session-1",
      formID: "form-1",
      answer: { summary: "Ship it", files: ["one.ts", "two.ts"] },
    });
  });

  it("passes each permission lifecycle reply through unchanged", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ permission: { reply } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    for (const value of ["once", "always", "reject"] as const) {
      await palot.replyPermission({
        sessionID: "session-1",
        requestID: `permission-${value}`,
        reply: value,
      });
    }

    expect(reply.mock.calls.map(([input]) => input)).toEqual([
      { sessionID: "session-1", requestID: "permission-once", decision: "once" },
      { sessionID: "session-1", requestID: "permission-always", decision: "always" },
      { sessionID: "session-1", requestID: "permission-reject", decision: "reject" },
    ]);
  });

  it("forwards form cancellation aliases and session interruption", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const interrupt = vi.fn().mockResolvedValue(undefined);
    setOpenCodeClientForTest(client({ session: { interrupt, form: { cancel } } }));
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await palot.rejectQuestion({ sessionID: "session-1", requestID: "question-1" });
    await palot.cancelForm({ sessionID: "session-1", formID: "form-1" });
    await palot.interrupt("session-1");

    expect(cancel.mock.calls.map(([input]) => input)).toEqual([
      { sessionID: "session-1", formID: "question-1" },
      { sessionID: "session-1", formID: "form-1" },
    ]);
    expect(interrupt).toHaveBeenCalledWith({ sessionID: "session-1" });
  });

  it("loads diagnostics, active context, instruction entries, and workspace directories", async () => {
    const stats = vi.fn().mockResolvedValue({ sessions: 2 });
    const context = vi.fn().mockResolvedValue([{ id: "message-1" }]);
    const listEntries = vi.fn().mockResolvedValue([{ key: "automation", value: "memory" }]);
    const removeEntry = vi.fn().mockResolvedValue(undefined);
    const listFiles = vi.fn().mockResolvedValue({
      data: [{ path: "src", type: "directory" }],
    });
    setOpenCodeClientForTest(
      client({
        session: {
          stats,
          context,
          instructions: { entry: { list: listEntries, remove: removeEntry } },
        },
        file: { list: listFiles },
      }),
    );
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    const statsInput = {
      from: 10,
      to: 20,
      timezone: "Europe/Amsterdam",
      tools: "summary" as const,
    };
    await expect(palot.sessionStats(statsInput)).resolves.toEqual({ sessions: 2 });
    await expect(palot.loadSessionContext("session-1")).resolves.toEqual([{ id: "message-1" }]);
    await expect(palot.listSessionInstructionEntries("session-1")).resolves.toEqual([
      { key: "automation", value: "memory" },
    ]);
    await palot.removeSessionInstructionEntry("session-1", "automation");
    await expect(
      palot.listWorkspaceDirectory({ directory: "/repo", path: "src" }),
    ).resolves.toEqual([{ path: "src", type: "directory" }]);

    expect(context).toHaveBeenCalledWith(
      { sessionID: "session-1" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(stats).toHaveBeenCalledWith(
      statsInput,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(removeEntry).toHaveBeenCalledWith(
      { sessionID: "session-1", key: "automation" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(listFiles).toHaveBeenCalledWith(
      { location: { directory: "/repo" }, path: "src" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("loads only requested session resources", async () => {
    const permissions = vi.fn().mockResolvedValue([]);
    setOpenCodeClientForTest(
      client({
        permission: { list: permissions },
        session: {
          form: { list: vi.fn().mockResolvedValue([]) },
          inbox: { list: vi.fn().mockResolvedValue([]) },
        },
      }),
    );
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    const result = await palot.loadSession(
      {
        id: session.id,
        parentID: null,
        projectID: session.projectID,
        title: null,
        agent: null,
        model: null,
        location: session.location,
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
        cost: null,
        tokens: session.tokens,
      },
      { messages: false, requests: true, diffs: false },
    );

    expect(permissions).toHaveBeenCalledWith(
      { sessionID: "session-1" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({ messages: null, diffs: null });
  });

  it("loads only inbox state for the selected-session request projection", async () => {
    const permissions = vi.fn();
    const forms = vi.fn();
    const inbox = vi.fn().mockResolvedValue([]);
    setOpenCodeClientForTest(
      client({
        permission: { list: permissions },
        session: { form: { list: forms }, inbox: { list: inbox } },
      }),
    );
    Object.defineProperty(window, "palot", { configurable: true, value: bridge() });

    await palot.loadSessionInbox("session-1");

    expect(inbox).toHaveBeenCalledWith(
      { sessionID: "session-1" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(permissions).not.toHaveBeenCalled();
    expect(forms).not.toHaveBeenCalled();
  });

  it("loads attention through the shared main-process index", async () => {
    const loadAttentionSnapshot = vi
      .fn()
      .mockResolvedValue({ complete: true, sessions: [], requests: [] });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: bridge({ loadAttentionSnapshot }),
    });

    await palot.loadAttentionSnapshot([], "explicit");
    expect(loadAttentionSnapshot).toHaveBeenCalledWith({
      connectionID: "explicit",
      sessions: [],
    });
  });

  it("uses deterministic preview data without a bridge", async () => {
    window.history.replaceState({}, "", "/?state=empty");
    const result = await palot.hydratePreview();
    expect(result.sessions.data).toEqual([]);
    expect(result.activeSessions).toEqual([]);
  });

  it("keeps preview transcripts in the official message response shape", async () => {
    const result = await palot.loadTranscript({
      id: "first-shell",
      parentID: null,
      projectID: "palot-2",
      title: "Build the first Palot 2 shell",
      agent: "build",
      model: { id: "gpt-5.6", providerID: "openai" },
      location: { directory: "/Users/you/Projects/palot-2" },
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      cost: null,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    });

    expect(result.data.map((message) => message.type)).toEqual(["user", "assistant", "assistant"]);
    expect(result.data[0]).toHaveProperty("time.created");
    expect(result.data[0]).not.toHaveProperty("createdAt");
  });
});
