import { atom } from "jotai";
import type { DesktopNotificationSettings } from "../../shared";
import {
  DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
  isNotificationSoundPreferences,
} from "../lib/notification-sounds";
import { persistedAtom } from "./persisted";

export const notificationSoundPreferencesAtom = persistedAtom({
  key: "notification-sounds",
  initialValue: DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
  validate: isNotificationSoundPreferences,
});

/** Native alert settings owned by the main process; `null` until loaded. */
export const desktopNotificationSettingsAtom = atom<DesktopNotificationSettings | null>(null);
