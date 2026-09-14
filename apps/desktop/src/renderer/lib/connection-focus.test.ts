import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotMessage } from "../../shared";
import { attentionTargetAtom } from "../atoms/attention";
import { discoveredProfileIDsAtom, includedProfileIDsAtom } from "../atoms/connections";
import { composerStateAtomFamily } from "../atoms/composer-state";
import { composerDraftAtomFamily, flushComposerDrafts } from "../atoms/ui";
import {
  activeShellsAtom,
  inspectorOpenSessionIDsAtom,
  messagesAtom,
  messagesForProfileAtom,
  newTaskProjectIDAtom,
  runtimeAtom,
  selectedSessionIDAtom,
  shellsForProfileAtom,
} from "../atoms/workspace";
import * as openCodeClient from "../services/opencode-client";
import { palot } from "../services/palot";
import { composerScope } from "./composer-scope";
import { focusConnection } from "./connection-focus";
import { emptyComposerDraft } from "./composer-draft";
import { createRendererQueryClient } from "./query-client";

const mocks = vi.hoisted(() => ({
  refreshRegistry: vi.fn().mockResolvedValue(undefined),
  getSnapshot: vi.fn<
    () => {
      profile: { id: string };
      runtime: OpenCodeRuntimeStatus;
      sessions: { id: string }[];
    }[]
  >(() => []),
}));
vi.mock("./connection-overview", () => ({ connectionOverview: () => mocks }));

function runtime(profileID: string): OpenCodeRuntimeStatus {
  return {
    connectionID: `connection-${profileID}`,
    profileID,
    contractVersion: "test",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: "test",
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  };
}

function optimistic(text: string): PalotMessage {
  return {
    id: "same-input",
    type: "user",
    text,
    optimistic: true,
    createdAt: 1,
    completedAt: null,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
  };
}

function fixture() {
  const store = createStore();
  const queryClient = createRendererQueryClient();
  const origin = runtime("origin");
  store.set(runtimeAtom, origin);
  openCodeClient.setFocusedOpenCodeRuntime(origin);
  store.set(selectedSessionIDAtom, "same-session");
  store.set(newTaskProjectIDAtom, "origin-project");
  store.set(inspectorOpenSessionIDsAtom, ["same-session"]);
  store.set(includedProfileIDsAtom, [origin.profileID]);
  const messages = new Map([["same-session", [optimistic("Origin prompt")]]]);
  const shells = new Map([["same-session", new Set(["origin-shell"])]]);
  store.set(messagesAtom, messages);
  store.set(activeShellsAtom, shells);
  const draftAtom = composerDraftAtomFamily(
    composerScope(origin.profileID, "session:same-session"),
  );
  const draft = { ...emptyComposerDraft(), text: "Unsent origin draft" };
  store.set(draftAtom, draft);
  const stateAtom = composerStateAtomFamily(
    composerScope(origin.profileID, "session:same-session"),
  );
  store.set(stateAtom, (state) => ({
    ...state,
    files: [{ uri: "file:///origin.txt", name: "origin.txt", mime: "text/plain", size: 1 }],
    sending: true,
  }));
  return { store, queryClient, origin, messages, shells, draftAtom, draft, stateAtom };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.refreshRegistry.mockClear();
  mocks.getSnapshot.mockReset().mockReturnValue([]);
});
afterEach(() => {
  flushComposerDrafts();
  openCodeClient.resetOpenCodeClientForTest();
  vi.restoreAllMocks();
});

describe("focusConnection", () => {
  it("restores a disabled current server route without reconnecting or needing cached tasks", async () => {
    const { store, queryClient, origin } = fixture();
    store.set(runtimeAtom, null);
    store.set(discoveredProfileIDsAtom, [origin.profileID]);
    store.set(includedProfileIDsAtom, []);
    vi.spyOn(palot, "runtimeStatus").mockResolvedValue(origin);
    const switchProfile = vi.spyOn(palot, "switchOpenCodeProfile");
    await expect(focusConnection(queryClient, store, origin.profileID)).resolves.toMatchObject({
      profileID: origin.profileID,
      connected: false,
      phase: "stopped",
    });
    expect(switchProfile).not.toHaveBeenCalled();
    expect(store.get(includedProfileIDsAtom)).toEqual([]);
  });

  it("keeps the selected task and drafts offline when its server is disabled", async () => {
    const { store, queryClient, origin, messages, draftAtom, draft } = fixture();
    store.set(discoveredProfileIDsAtom, [origin.profileID]);
    store.set(includedProfileIDsAtom, []);
    const switchProfile = vi.spyOn(palot, "switchOpenCodeProfile");
    await focusConnection(queryClient, store, origin.profileID);
    await focusConnection(queryClient, store, origin.profileID);
    expect(switchProfile).not.toHaveBeenCalled();
    expect(store.get(runtimeAtom)).toMatchObject({
      profileID: origin.profileID,
      connected: false,
      phase: "stopped",
    });
    expect(store.get(includedProfileIDsAtom)).toEqual([]);
    expect(store.get(selectedSessionIDAtom)).toBe("same-session");
    expect(store.get(messagesAtom)).toBe(messages);
    expect(store.get(draftAtom)).toEqual(draft);
  });

  it("reconciles main on a queued return to the renderer profile after an in-flight abort", async () => {
    const { store, queryClient, origin, messages } = fixture();
    const pending = Promise.withResolvers<OpenCodeRuntimeStatus>();
    const controller = new AbortController();
    const switchProfile = vi
      .spyOn(palot, "switchOpenCodeProfile")
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(origin);
    const switching = focusConnection(queryClient, store, "other", controller.signal);
    const rejected = expect(switching).rejects.toThrow("cancelled");
    await Promise.resolve();
    await Promise.resolve();
    expect(switchProfile).toHaveBeenCalledExactlyOnceWith("other");
    controller.abort(new Error("cancelled"));
    const returning = focusConnection(queryClient, store, origin.profileID);
    expect(switchProfile).toHaveBeenCalledTimes(1);
    pending.resolve(runtime("other"));
    await rejected;
    await returning;
    expect(switchProfile.mock.calls).toEqual([["other"], ["origin"]]);
    expect(store.get(runtimeAtom)).toBe(origin);
    expect(store.get(messagesAtom)).toBe(messages);
    expect(store.get(selectedSessionIDAtom)).toBe("same-session");
    expect(store.get(newTaskProjectIDAtom)).toBe("origin-project");
    expect(store.get(inspectorOpenSessionIDsAtom)).toEqual(["same-session"]);

    // Once synchronized, the same-profile fast path is safe again.
    await focusConnection(queryClient, store, origin.profileID);
    expect(switchProfile).toHaveBeenCalledTimes(2);
  });

  it("does not switch an already cancelled request", async () => {
    const { store, queryClient, origin } = fixture();
    const switchProfile = vi.spyOn(palot, "switchOpenCodeProfile");
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(focusConnection(queryClient, store, "other", controller.signal)).rejects.toThrow(
      "cancelled",
    );
    await focusConnection(queryClient, store, origin.profileID);
    expect(switchProfile).not.toHaveBeenCalled();
    expect(store.get(runtimeAtom)).toBe(origin);
  });

  it("keeps cached offline navigation available and retries main focus on the next visit", async () => {
    const { store, queryClient } = fixture();
    const other = runtime("other");
    mocks.getSnapshot.mockReturnValue([
      { profile: { id: other.profileID }, runtime: other, sessions: [{ id: "cached" }] },
    ]);
    const switchProfile = vi
      .spyOn(palot, "switchOpenCodeProfile")
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(other);
    await focusConnection(queryClient, store, other.profileID);
    expect(store.get(runtimeAtom)).toEqual({
      ...other,
      connected: false,
      phase: "error",
      error: "Offline",
    });
    await focusConnection(queryClient, store, other.profileID);
    expect(switchProfile.mock.calls).toEqual([["other"], ["other"]]);
    expect(store.get(runtimeAtom)).toBe(other);
  });

  it("isolates duplicate session IDs and restores each profile's selection, shells and drafts", async () => {
    const { store, queryClient, origin, messages, shells, draftAtom, draft, stateAtom } = fixture();
    const originState = store.get(stateAtom);
    const other = runtime("other");
    vi.spyOn(palot, "switchOpenCodeProfile")
      .mockResolvedValueOnce(other)
      .mockResolvedValueOnce(origin);

    await focusConnection(queryClient, store, other.profileID);
    expect(store.get(runtimeAtom)).toEqual(other);
    expect(store.get(messagesAtom).size).toBe(0);
    expect(store.get(activeShellsAtom).size).toBe(0);
    expect(store.get(selectedSessionIDAtom)).toBeNull();
    expect(store.get(newTaskProjectIDAtom)).toBeNull();
    expect(store.get(inspectorOpenSessionIDsAtom)).toEqual([]);
    const otherMessages = new Map([["same-session", [optimistic("Other prompt")]]]);
    const otherShells = new Map([["same-session", new Set(["other-shell"])]]);
    store.set(messagesAtom, otherMessages);
    store.set(activeShellsAtom, otherShells);
    store.set(selectedSessionIDAtom, "other-selected");
    store.set(newTaskProjectIDAtom, "other-project");
    store.set(inspectorOpenSessionIDsAtom, ["other-selected"]);
    const otherDraftAtom = composerDraftAtomFamily(
      composerScope(other.profileID, "session:same-session"),
    );
    expect(store.get(otherDraftAtom).text).toBe("");
    store.set(otherDraftAtom, { ...emptyComposerDraft(), text: "Other unsent draft" });

    // An operation that captured the origin family cannot mutate the focused facade.
    store.set(messagesForProfileAtom(origin.profileID), messages);
    store.set(shellsForProfileAtom(origin.profileID), shells);
    expect(store.get(messagesAtom)).toBe(otherMessages);
    expect(store.get(activeShellsAtom)).toBe(otherShells);

    await focusConnection(queryClient, store, origin.profileID);
    expect(store.get(messagesAtom)).toBe(messages);
    expect(store.get(activeShellsAtom)).toBe(shells);
    expect(store.get(selectedSessionIDAtom)).toBe("same-session");
    expect(store.get(newTaskProjectIDAtom)).toBe("origin-project");
    expect(store.get(inspectorOpenSessionIDsAtom)).toEqual(["same-session"]);
    expect(store.get(draftAtom)).toEqual(draft);
    expect(store.get(stateAtom)).toBe(originState);
    expect(store.get(otherDraftAtom).text).toBe("Other unsent draft");
    expect(store.get(messagesForProfileAtom(other.profileID))).toBe(otherMessages);
    expect(store.get(shellsForProfileAtom(other.profileID))).toBe(otherShells);
  });

  it("leaves original focus and local state intact when a main-process switch has no cached fallback and fails", async () => {
    const { store, queryClient, origin, messages, shells, draftAtom, draft, stateAtom } = fixture();
    const state = store.get(stateAtom);
    const target = { sessionID: "same-session", requestID: "request", type: "input" as const };
    store.set(attentionTargetAtom, target);
    const pending = Promise.withResolvers<OpenCodeRuntimeStatus>();
    const switchProfile = vi.spyOn(palot, "switchOpenCodeProfile").mockReturnValue(pending.promise);
    const focus = vi.spyOn(openCodeClient, "setFocusedOpenCodeRuntime");
    const switching = focusConnection(queryClient, store, "unreachable");
    await Promise.resolve();
    await Promise.resolve();
    expect(switchProfile).toHaveBeenCalledWith("unreachable");

    const unchanged = () => {
      expect(store.get(runtimeAtom)).toBe(origin);
      expect(store.get(messagesAtom)).toBe(messages);
      expect(store.get(activeShellsAtom)).toBe(shells);
      expect(store.get(selectedSessionIDAtom)).toBe("same-session");
      expect(store.get(newTaskProjectIDAtom)).toBe("origin-project");
      expect(store.get(inspectorOpenSessionIDsAtom)).toEqual(["same-session"]);
      expect(store.get(attentionTargetAtom)).toBe(target);
      expect(store.get(draftAtom)).toEqual(draft);
      expect(store.get(stateAtom)).toBe(state);
      expect(store.get(includedProfileIDsAtom)).toEqual([origin.profileID]);
      expect(focus).not.toHaveBeenCalled();
      expect(mocks.refreshRegistry).not.toHaveBeenCalled();
    };
    unchanged();
    pending.reject(new Error("Remote is unreachable"));
    await expect(switching).rejects.toThrow("Remote is unreachable");
    unchanged();

    // A rejected switch must not poison the serialized queue.
    switchProfile.mockResolvedValue(runtime("available"));
    await focusConnection(queryClient, store, "available");
    expect(store.get(runtimeAtom)?.profileID).toBe("available");
  });
});
