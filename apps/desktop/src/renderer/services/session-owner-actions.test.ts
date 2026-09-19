import type { SessionInfo } from "@opencode/client";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotApi } from "../../shared";
import { resetOpenCodeClientForTest, setFocusedOpenCodeRuntime } from "./opencode-client";
import { palot } from "./palot";

const owner = {
  connectionID: "background",
  profileID: "background-profile",
  connected: true,
  phase: "connected",
} as OpenCodeRuntimeStatus;
const session: SessionInfo = {
  id: "duplicate",
  projectID: "project",
  cost: 0,
  location: { directory: "/repo" },
  time: { created: 1, updated: 1 },
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

afterEach(() => {
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

it.each([false, true])(
  "retains a command's owner across delayed file-location lookup (explicit=%s)",
  async (explicit) => {
    setFocusedOpenCodeRuntime(owner);
    if (explicit)
      setFocusedOpenCodeRuntime({
        ...owner,
        connectionID: "focused",
        profileID: "focused-profile",
      });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = vi.fn(async (input: { method: string }) => {
      if (input.method === "GET") await barrier;
      return {
        status: input.method === "GET" ? 200 : 204,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body:
          input.method === "GET"
            ? new TextEncoder().encode(JSON.stringify({ data: session })).buffer
            : null,
      };
    });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: {
        openCodeRequest: request,
        runtimeStatus: vi.fn().mockResolvedValue(owner),
      } as unknown as PalotApi,
    });
    const pending = palot.runCommand(
      {
        sessionID: session.id,
        command: "review",
        fileReferences: [
          { path: "file.ts", name: "file.ts", mention: { text: "@file.ts", start: 0, end: 8 } },
        ],
      },
      explicit ? owner.connectionID : undefined,
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    setFocusedOpenCodeRuntime({ ...owner, connectionID: "changed", profileID: "changed-profile" });
    release();
    await pending;
    expect(request).toHaveBeenCalledTimes(2);
    for (const [input] of request.mock.calls)
      expect(input).toMatchObject({ connectionID: owner.connectionID, profileID: owner.profileID });
  },
);

it.each(["fork", "delete", "export", "copy", "list worktrees", "create worktree"] as const)(
  "%s uses the explicit owner's official client instead of the focused duplicate",
  async (operation) => {
    setFocusedOpenCodeRuntime(owner);
    setFocusedOpenCodeRuntime({ ...owner, connectionID: "focused", profileID: "focused-profile" });
    const request = vi.fn().mockImplementation(async (input: { path: string; method: string }) => {
      const data =
        operation === "export" || operation === "copy"
          ? { info: session, messages: [] }
          : operation === "list worktrees"
            ? []
            : operation === "create worktree"
              ? {
                  directory: "/worktrees/new",
                  project: { id: "project", directory: "/repo", canonical: "/repo" },
                }
              : operation === "delete"
                ? undefined
                : session;
      // Change focus between worktree creation and its location-registration follow-up.
      if (operation === "create worktree" && input.method === "POST") {
        setFocusedOpenCodeRuntime({
          ...owner,
          connectionID: "changed",
          profileID: "changed-profile",
        });
      }
      return {
        status: operation === "delete" ? 204 : 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body:
          operation === "delete"
            ? null
            : new TextEncoder().encode(
                JSON.stringify(
                  operation === "list worktrees" || operation === "create worktree"
                    ? data
                    : { data },
                ),
              ).buffer,
      };
    });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: {
        runtimeStatus: vi.fn().mockResolvedValue(owner),
        openCodeRequest: request,
        saveSessionExport: vi.fn().mockResolvedValue(null),
        writeClipboardText: vi.fn().mockResolvedValue(undefined),
      } as unknown as PalotApi,
    });

    if (operation === "fork")
      await palot.forkSession({ sessionID: session.id }, owner.connectionID);
    if (operation === "delete") await palot.removeSession(session.id, owner.connectionID);
    if (operation === "export") await palot.exportSession(session.id, "Task", owner.connectionID);
    if (operation === "copy") await palot.copySessionMarkdown(session.id, owner.connectionID);
    if (operation === "list worktrees")
      await palot.listProjectDirectories(session.projectID, "/repo", undefined, owner.connectionID);
    if (operation === "create worktree")
      await palot.createProjectCopy(session.projectID, "/repo", undefined, owner.connectionID);

    expect(request).toHaveBeenCalledTimes(operation === "create worktree" ? 3 : 1);
    for (const [input] of request.mock.calls) {
      expect(input).toMatchObject({ connectionID: owner.connectionID, profileID: owner.profileID });
    }
  },
);
