import { Play, Volume2 } from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
import type { DesktopNotificationDeliveryStatus } from "../../shared";
import {
  desktopNotificationSettingsAtom,
  notificationSoundPreferencesAtom,
} from "../atoms/notification-sounds";
import {
  NOTIFICATION_SOUND_EVENTS,
  NOTIFICATION_SOUND_OPTIONS,
  notificationSoundsEnabled,
  playNotificationSound,
  type NotificationSoundChoice,
  type NotificationSoundID,
} from "../lib/notification-sounds";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { SettingsGroup, SettingsRow, SettingsSection } from "./settings-layout";

const SOUND_LABELS: Record<NotificationSoundChoice, string> = {
  off: "Off",
  ...(Object.fromEntries(NOTIFICATION_SOUND_OPTIONS.map(({ id, label }) => [id, label])) as Record<
    NotificationSoundID,
    string
  >),
};

export function NotificationSoundSettings({
  deliveryStatus,
  play = playNotificationSound,
}: {
  /** macOS delivery status, when Palot has already read it. */
  deliveryStatus: DesktopNotificationDeliveryStatus | null;
  play?: (sound: NotificationSoundID) => void;
}) {
  const [preferences, setPreferences] = useAtom(notificationSoundPreferencesAtom);
  const desktopSettings = useAtomValue(desktopNotificationSettingsAtom);
  const alertsOff =
    deliveryStatus?.authorization === "denied" || deliveryStatus?.delivery === "off";

  return (
    <SettingsSection
      title="Sounds"
      description={
        desktopSettings?.turnCompletion === "unfocused"
          ? "Play a short sound when tasks finish or need you. Turn sounds play only while Palot is in the background, like turn completion notifications."
          : "Play a short sound when tasks finish or need you."
      }
      icon={Volume2}
    >
      {alertsOff && notificationSoundsEnabled(preferences) ? (
        <p role="note" className="text-compact text-muted-foreground">
          macOS alerts are off for Palot, so these events only play a sound.
        </p>
      ) : null}
      <SettingsGroup>
        {NOTIFICATION_SOUND_EVENTS.map((event) => {
          const choice = preferences[event.id];
          return (
            <SettingsRow
              key={event.id}
              title={event.label}
              description={event.description}
              control={
                <>
                  <Select
                    value={choice}
                    onValueChange={(value) =>
                      setPreferences((current) => ({
                        ...current,
                        [event.id]: value as NotificationSoundChoice,
                      }))
                    }
                  >
                    <SelectTrigger
                      className="w-full @lg/settings:w-32"
                      aria-label={`${event.label} sound`}
                    >
                      <SelectValue>{SOUND_LABELS[choice]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="off">Off</SelectItem>
                      {NOTIFICATION_SOUND_OPTIONS.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Play ${event.label.toLowerCase()} sound`}
                    title="Play sound"
                    disabled={choice === "off"}
                    onClick={() => {
                      if (choice !== "off") play(choice);
                    }}
                  >
                    <Play aria-hidden="true" />
                  </Button>
                </>
              }
            />
          );
        })}
      </SettingsGroup>
    </SettingsSection>
  );
}
