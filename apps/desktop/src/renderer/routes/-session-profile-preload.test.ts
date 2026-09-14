import { createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotApi } from "../../shared";
import { messagesAtom, runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import * as openCodeCatalog from "../services/opencode-catalog";
import * as openCodeClient from "../services/opencode-client";
import { palot } from "../services/palot";
import { mapSession } from "../services/opencode-mappers";
import { sessionTranscriptQueryOptions, transcriptQueryKey } from "../hooks/use-session-transcript";
import { Route } from "./_workspace.sessions.$sessionID";

vi.mock("../components/thread", () => ({ Thread: () => null }));
vi.mock("../hooks/use-session-info", () => ({ useAcknowledgeSessionView: () => undefined }));

function runtime(profileID: string, connected = true): OpenCodeRuntimeStatus {
  return {
    profileID,
    connectionID: `connection-${profileID}`,
    connected,
    phase: connected ? "connected" : "error",
    contractVersion: "test",
    version: "test",
    binaryPath: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: connected ? null : "Offline",
    versionMismatch: null,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  openCodeClient.resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

it.each(["connected", "offline", "missing"])(
  "preloading a %s background profile never focuses it or falls back to the focused server",
  async (status) => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const origin = runtime("origin");
    const background = runtime("background", status === "connected");
    store.set(runtimeAtom, origin);
    store.set(selectedSessionIDAtom, "origin-selected");
    const messages = store.get(messagesAtom);
    openCodeClient.setFocusedOpenCodeRuntime(origin);
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: {
        listOpenCodeRuntimes: vi
          .fn()
          .mockResolvedValue(status === "missing" ? [origin] : [origin, background]),
      } as unknown as PalotApi,
    });
    vi.spyOn(palot, "isPreview").mockReturnValue(false);
    const switchProfile = vi.spyOn(palot, "switchOpenCodeProfile");
    const focus = vi.spyOn(openCodeClient, "setFocusedOpenCodeRuntime");
    const getSession = vi.spyOn(palot, "getSession");
    const getSessionInfo = vi.spyOn(openCodeCatalog, "getSessionInfo").mockResolvedValue(null);
    const loader = Route.options.loader;
    if (typeof loader !== "function") throw new Error("Session route loader is required");
    await loader({
      context: { store, queryClient },
      params: { sessionID: "same-session" },
      deps: { profileID: background.profileID },
      preload: true,
      cause: "preload",
      abortController: new AbortController(),
    } as Parameters<typeof loader>[0]);

    expect(store.get(runtimeAtom)).toBe(origin);
    expect(store.get(selectedSessionIDAtom)).toBe("origin-selected");
    expect(store.get(messagesAtom)).toBe(messages);
    expect(switchProfile).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    if (status === "connected") {
      expect(getSessionInfo).toHaveBeenCalledExactlyOnceWith(
        "same-session",
        expect.any(AbortSignal),
        background.connectionID,
      );
    } else {
      expect(getSessionInfo).not.toHaveBeenCalled();
    }
  },
);

it.each([true, false])(
  "uses only the destination's warm session record (cached: %s)",
  async (cached) => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const owner = runtime("destination");
    store.set(runtimeAtom, owner);
    vi.spyOn(palot, "isPreview").mockReturnValue(false);
    const getSession = vi.spyOn(openCodeCatalog, "getSessionInfo").mockResolvedValue(null);
    const reconciler = openCodeReconciler(queryClient);
    reconciler.upsertSessionInfos(cached ? owner.connectionID : "connection-other", [
      {
        id: "ses_same",
        projectID: "project",
        title: "Cached task",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 1 },
        location: { directory: "/repo" },
      },
    ]);
    const loader = Route.options.loader;
    if (typeof loader !== "function") throw new Error("Session route loader is required");
    await loader({
      context: { store, queryClient },
      params: { sessionID: "ses_same" },
      deps: { profileID: owner.profileID },
      preload: true,
    } as Parameters<typeof loader>[0]);
    if (cached) expect(getSession).not.toHaveBeenCalled();
    else
      expect(getSession).toHaveBeenCalledExactlyOnceWith(
        "ses_same",
        expect.any(AbortSignal),
        owner.connectionID,
      );
    queryClient.clear();
  },
);

it.each([
  { cached: true, preload: false, warm: false },
  { cached: false, preload: false, warm: false },
  { cached: true, preload: true, warm: false },
  { cached: false, preload: true, warm: false },
  { cached: true, preload: false, warm: true },
])(
  "starts nonblocking hydration only on cold navigation: %j",
  async ({ cached, preload, warm }) => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const owner = runtime("destination");
    store.set(runtimeAtom, owner);
    vi.spyOn(palot, "isPreview").mockReturnValue(false);
    const info = {
      id: "ses_same",
      projectID: "project",
      title: "Task",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      location: { directory: "/repo" },
    };
    vi.spyOn(openCodeCatalog, "getSessionInfo").mockResolvedValue(info);
    const reconciler = openCodeReconciler(queryClient);
    if (cached) reconciler.upsertSessionInfos(owner.connectionID, [info]);
    const page = { data: [], cursor: { previous: null, next: "older" } };
    const warmData = { pages: [page], pageParams: [null] };
    if (warm) {
      queryClient.setQueryData(transcriptQueryKey(owner.connectionID, info.id), warmData);
      // Navigation must retain the hook's refetchOnMount:false behavior even when
      // background events have invalidated a retained transcript.
      await queryClient.invalidateQueries({
        queryKey: transcriptQueryKey(owner.connectionID, info.id),
        refetchType: "none",
      });
    }
    let resolve!: (value: typeof page) => void;
    const loadTranscript = vi.spyOn(palot, "loadTranscript").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const loader = Route.options.loader;
    if (typeof loader !== "function") throw new Error("Session route loader is required");
    await loader({
      context: { store, queryClient },
      params: { sessionID: info.id },
      deps: { profileID: owner.profileID },
      preload,
    } as Parameters<typeof loader>[0]);
    if (warm) {
      expect(loadTranscript).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(transcriptQueryKey(owner.connectionID, info.id))).toEqual(
        warmData,
      );
    } else if (preload) {
      expect(loadTranscript).not.toHaveBeenCalled();
      expect(
        queryClient.getQueryState(transcriptQueryKey(owner.connectionID, info.id)),
      ).toBeUndefined();
    } else {
      const session = mapSession(reconciler.session(owner.connectionID, info.id)!);
      expect(loadTranscript).toHaveBeenCalledExactlyOnceWith(
        session,
        "rooted",
        expect.any(AbortSignal),
        owner.connectionID,
      );
      // The mounted consumer shares the loader's in-flight query rather than restarting it.
      const pending = queryClient.fetchInfiniteQuery(
        sessionTranscriptQueryOptions(queryClient, session, owner),
      );
      expect(loadTranscript).toHaveBeenCalledTimes(1);
      resolve(page);
      expect(await pending).toEqual({ pages: [page], pageParams: [null] });
      expect(
        queryClient.getQueryData(transcriptQueryKey("connection-other", info.id)),
      ).toBeUndefined();
    }
    queryClient.clear();
  },
);
