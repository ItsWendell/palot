import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useEffect } from "react";
import {
  desktopNotificationSettingsAtom,
  notificationSoundPreferencesAtom,
} from "../atoms/notification-sounds";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import {
  createNotificationSoundController,
  playNotificationSound,
  type NotificationSoundID,
} from "../lib/notification-sounds";
import { palot } from "../services/palot";

const OWNER_KEY = "palot.desktop.notification-sounds.owner";

/**
 * Every Palot window receives the same events, so the most recently focused window
 * plays sounds for all of them.
 */
export function notificationSoundOwnership(
  token = globalThis.crypto?.randomUUID?.() ?? String(Math.random()),
) {
  const read = () => {
    try {
      return window.localStorage.getItem(OWNER_KEY);
    } catch {
      return null;
    }
  };
  return {
    claim() {
      try {
        window.localStorage.setItem(OWNER_KEY, token);
      } catch {
        // Without storage every window plays; that is better than none.
      }
    },
    claimed: () => read() !== null,
    owns: () => {
      const owner = read();
      return owner === null || owner === token;
    },
    release() {
      if (read() !== token) return;
      try {
        window.localStorage.removeItem(OWNER_KEY);
      } catch {
        // Best effort.
      }
    },
  };
}

/** Plays the chosen sound for live turn and attention events. Mount once per window. */
export function useNotificationSounds(
  play: (sound: NotificationSoundID) => void = playNotificationSound,
): void {
  const queryClient = useQueryClient();
  const store = useStore();

  useEffect(() => {
    let active = true;
    const loadSettings = () => {
      void palot
        .loadDesktopNotificationSettings()
        .then((settings) => {
          if (active) store.set(desktopNotificationSettingsAtom, settings);
        })
        .catch(() => undefined);
    };
    const ownership = notificationSoundOwnership();
    if (document.hasFocus() || !ownership.claimed()) ownership.claim();
    const onFocus = () => {
      ownership.claim();
      // Another window may have changed native alert settings.
      loadSettings();
    };
    const onPageHide = () => ownership.release();
    loadSettings();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);

    const reconciler = openCodeReconciler(queryClient);
    const controller = createNotificationSoundController({
      preferences: () => store.get(notificationSoundPreferencesAtom),
      desktopSettings: () => store.get(desktopNotificationSettingsAtom),
      focused: () => document.hasFocus(),
      owner: ownership.owns,
      isChildSession: (connectionID, sessionID) =>
        Boolean(reconciler.session(connectionID, sessionID)?.parentID),
      play,
      now: Date.now,
    });
    // Live, admitted batches only: replayed or hydrated history never reaches this listener.
    const unsubscribe = reconciler.subscribe(({ batch }) =>
      controller.handle(batch.connectionID, batch.events),
    );
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      ownership.release();
    };
  }, [play, queryClient, store]);
}
