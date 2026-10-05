import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotProject, PalotSession } from "../../shared";
import {
  isMissingSessionLocation,
  useSessionLocationMissing,
  type SessionLocationMissingOptions,
} from "./use-session-location-missing";

const api = vi.hoisted(() => ({
  client: vi.fn(),
  getLocation: vi.fn(),
  move: vi.fn(),
  getSession: vi.fn(),
  createWorktree: vi.fn(),
  list: vi.fn(),
}));
vi.mock("../services/opencode-client", () => ({ openCodeClient: api.client }));
vi.mock("../services/opencode-worktrees", () => ({ createWorktree: api.createWorktree }));
vi.mock("../services/opencode-mappers", () => ({ mapSession: (session: unknown) => session }));
vi.mock("../services/palot", () => ({ palot: { listProjectDirectories: api.list } }));

const missing = {
  _tag: "LocationNotFoundError",
  location: { directory: "/deleted" },
  message: "Missing",
};
const session = {
  id: "session",
  projectID: "project",
  location: { directory: "/deleted" },
} as PalotSession;
const project = { id: "project", canonical: "/canonical" } as PalotProject;
const owner = {
  profileID: "remote",
  connectionID: "remote-connection",
  connected: true,
  phase: "connected",
} as unknown as OpenCodeRuntimeStatus;

function setup(props: SessionLocationMissingOptions = { session, project, owner }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderHook(
    (options: SessionLocationMissingOptions) => useSessionLocationMissing(options),
    {
      initialProps: props,
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.client.mockReturnValue({
    location: { get: api.getLocation },
    session: { move: api.move, get: api.getSession },
  });
  api.getLocation.mockImplementation(({ location }) =>
    location.directory === "/deleted" ? Promise.reject(missing) : Promise.resolve({}),
  );
  api.list.mockResolvedValue([
    { directory: "/deleted" },
    { directory: "/canonical" },
    { directory: "/other" },
  ]);
  api.createWorktree.mockResolvedValue({ directory: "/created" });
  api.getSession.mockResolvedValue({ ...session, location: { directory: "/other" } });
});
afterEach(cleanup);

describe("missing workspace recovery", () => {
  it.each([
    new Error("ENOENT /deleted"),
    { status: 404 },
    { ...missing, location: { directory: "/another" } },
    { _tag: "ServiceUnavailableError", message: "offline" },
  ])("ignores nonmatching typed errors %#", (error) => {
    expect(isMissingSessionLocation(error, "/deleted", true)).toBe(false);
  });
  it("requires a healthy connection even for the exact published error", () => {
    expect(isMissingSessionLocation(missing, "/deleted", false)).toBe(false);
    expect(isMissingSessionLocation(missing, "/deleted", true)).toBe(true);
  });
  it("does not probe or recover an offline owner", async () => {
    const { result } = setup({
      session,
      project,
      owner: { ...owner, connected: false },
      error: missing,
    });
    expect(result.current.missing).toBe(false);
    await act(() => result.current.recover({ type: "create" }));
    expect(api.client).not.toHaveBeenCalled();
  });
  it("does not offer recovery for a network failure on a connected server", async () => {
    api.getLocation.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = setup();
    await waitFor(() => expect(api.getLocation).toHaveBeenCalled());
    expect(result.current.missing).toBe(false);
    expect(api.list).not.toHaveBeenCalled();
  });
  it("validates an existing directory and moves only on the session's owner", async () => {
    const onRecovered = vi.fn();
    const { result } = setup({ session, project, owner, onRecovered });
    await waitFor(() => expect(result.current.missing).toBe(true));
    await act(() => result.current.recover({ type: "existing", directory: "/other" }));
    expect(api.move).toHaveBeenCalledExactlyOnceWith(
      { sessionID: "session", directory: "/other" },
      { signal: expect.any(AbortSignal) },
    );
    expect(
      api.client.mock.calls.every(([connectionID]) => connectionID === "remote-connection"),
    ).toBe(true);
    expect(onRecovered).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ location: { directory: "/other" } }),
    );
    expect(result.current.missing).toBe(false);
  });
  it("ignores a missing-location probe that finishes for the previous directory", async () => {
    const probe = Promise.withResolvers<unknown>();
    api.getLocation.mockReturnValueOnce(probe.promise);
    const { result, rerender } = setup();
    await waitFor(() => expect(api.getLocation).toHaveBeenCalled());
    rerender({ session: { ...session, location: { directory: "/healthy" } }, project, owner });
    await act(async () => probe.reject(missing));
    expect(result.current.missing).toBe(false);
  });
  it("creates from the saved canonical checkout, never the missing directory", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.missing).toBe(true));
    await act(() => result.current.recover({ type: "create" }));
    expect(api.createWorktree).toHaveBeenCalledExactlyOnceWith(
      "project",
      undefined,
      expect.any(AbortSignal),
      "remote-connection",
      "/canonical",
    );
    expect(api.move).toHaveBeenCalledWith(
      { sessionID: "session", directory: "/created" },
      expect.anything(),
    );
  });
  it("keeps failure usable and allows retry", async () => {
    api.move.mockRejectedValueOnce(new Error("Move failed"));
    const { result } = setup();
    await waitFor(() => expect(result.current.missing).toBe(true));
    await act(() => result.current.recover({ type: "existing", directory: "/other" }));
    expect(result.current.error).toBe("Move failed");
    expect(result.current.pending).toBe(false);
    expect(result.current.missing).toBe(true);
    await act(() => result.current.recover({ type: "existing", directory: "/other" }));
    expect(result.current.missing).toBe(false);
  });
  it.each(["cancel", "task", "connection", "offline"])(
    "ignores a late creation after %s",
    async (change) => {
      const creation = Promise.withResolvers<{ directory: string }>();
      api.createWorktree.mockReturnValueOnce(creation.promise);
      const onRecovered = vi.fn();
      const { result, rerender } = setup({ session, project, owner, onRecovered });
      await waitFor(() => expect(result.current.missing).toBe(true));
      let recovery!: Promise<void>;
      act(() => {
        recovery = result.current.recover({ type: "create" });
      });
      expect(result.current.pending).toBe(true);
      if (change === "cancel") act(() => result.current.cancel());
      else
        rerender({
          session: change === "task" ? { ...session, id: "another" } : session,
          project,
          owner:
            change === "connection"
              ? { ...owner, connectionID: "new-connection" }
              : change === "offline"
                ? { ...owner, connected: false }
                : owner,
          onRecovered,
        });
      await act(async () => {
        creation.resolve({ directory: "/late" });
        await recovery;
      });
      expect(api.move).not.toHaveBeenCalled();
      expect(onRecovered).not.toHaveBeenCalled();
      expect(result.current.pending).toBe(false);
      if (change === "offline") {
        rerender({ session, project, owner, onRecovered });
        expect(result.current.pending).toBe(false);
      }
    },
  );
});
