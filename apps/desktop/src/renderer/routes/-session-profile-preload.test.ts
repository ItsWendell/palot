import { createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotApi } from "../../shared";
import { messagesAtom, runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import * as openCodeCatalog from "../services/opencode-catalog";
import * as openCodeClient from "../services/opencode-client";
import { palot } from "../services/palot";
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
