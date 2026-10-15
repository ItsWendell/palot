import type { SessionLogOutput } from "@opencode/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PalotEvent } from "../../shared";
import { notificationSoundPreferencesAtom } from "../atoms/notification-sounds";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { palot } from "../services/palot";
import { useNotificationSounds } from "./use-notification-sounds";

const connectionID = "connection-1";

function succeeded(id: string, seq: number): PalotEvent {
  const now = Date.now();
  return {
    id,
    type: "session.execution.succeeded",
    created: now,
    createdAt: now,
    receiveSequence: seq,
    durable: { aggregateID: "ses_1", seq, version: 1 },
    data: { sessionID: "ses_1" },
  } as PalotEvent;
}

function mount() {
  vi.spyOn(palot, "loadDesktopNotificationSettings").mockResolvedValue({
    turnCompletion: "always",
    permissionRequests: true,
    questionRequests: true,
  });
  const queryClient = new QueryClient();
  const store = createStore();
  store.set(notificationSoundPreferencesAtom, (current) => ({
    ...current,
    turnCompleted: "chime",
  }));
  const play = vi.fn();
  const view = renderHook(() => useNotificationSounds(play), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    ),
  });
  const reconciler = openCodeReconciler(queryClient);
  let batchSequence = 0;
  const live = (...events: PalotEvent[]) =>
    reconciler.applyBatch({
      connectionID,
      contractVersion: "2.0.29",
      streamEpoch: 1,
      batchSequence: ++batchSequence,
      receivedAt: Date.now(),
      sentAt: Date.now(),
      events,
    });
  return { play, reconciler, live, store, view };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it("plays once for a live event and never for replayed history", async () => {
  const { play, reconciler, live } = mount();
  await waitFor(() => expect(palot.loadDesktopNotificationSettings).toHaveBeenCalled());

  reconciler.applyReplay(connectionID, "ses_1", [
    succeeded("evt_old", 1) as unknown as SessionLogOutput,
    { type: "log.synced", aggregateID: "ses_1", seq: 1 },
  ]);
  expect(play).not.toHaveBeenCalled();

  live(succeeded("evt_live", 2));
  expect(play).toHaveBeenCalledExactlyOnceWith("chime");

  // A reconnect that delivers the same event again stays silent.
  reconciler.applyBatch({
    connectionID,
    contractVersion: "2.0.29",
    streamEpoch: 2,
    batchSequence: 1,
    receivedAt: Date.now(),
    sentAt: Date.now(),
    events: [succeeded("evt_live", 3)],
  });
  expect(play).toHaveBeenCalledOnce();
});

it("stays silent when the sound is off or another window owns sounds", () => {
  const { play, live, store } = mount();
  store.set(notificationSoundPreferencesAtom, (current) => ({ ...current, turnCompleted: "off" }));
  live(succeeded("evt_1", 1));
  expect(play).not.toHaveBeenCalled();

  store.set(notificationSoundPreferencesAtom, (current) => ({
    ...current,
    turnCompleted: "chime",
  }));
  window.localStorage.setItem("palot.desktop.notification-sounds.owner", "another-window");
  live(succeeded("evt_2", 2));
  expect(play).not.toHaveBeenCalled();
});

it("stops listening when unmounted", () => {
  const { play, live, view } = mount();
  view.unmount();
  live(succeeded("evt_1", 1));
  expect(play).not.toHaveBeenCalled();
});
