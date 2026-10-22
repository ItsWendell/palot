import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import { KeyRound, Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { runtimeAtom } from "../../atoms/workspace";
import { VOICE_OPTIONS, voicePreferencesAtom } from "../../atoms/voice";
import { supportsOpenCodeVoice } from "../../lib/voice/voice-support";
import { openCodeClient } from "../../services/opencode-client";
import { voiceCall } from "../../services/voice-call";
import { SettingsGroup, SettingsNotice, SettingsRow, SettingsSection } from "../settings-layout";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { VoiceCoordinatorSettings } from "./voice-coordinator-settings";

const isMac = window.palot?.platform === "darwin";

/** Electron accelerators offered for the OS-wide shortcut. */
const GLOBAL_SHORTCUTS: readonly { value: string | null; label: string }[] = [
  { value: null, label: "Off" },
  { value: "CommandOrControl+Alt+V", label: isMac ? "⌘⌥V" : "Ctrl+Alt+V" },
  { value: "CommandOrControl+Shift+Space", label: isMac ? "⇧⌘Space" : "Ctrl+Shift+Space" },
  { value: "Alt+Shift+Space", label: isMac ? "⌥⇧Space" : "Alt+Shift+Space" },
];

function useMicrophones(): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    const refresh = () =>
      void media
        .enumerateDevices()
        .then((all) =>
          setDevices(
            all.filter((device) => device.kind === "audioinput" && device.deviceId !== "default"),
          ),
        )
        .catch(() => setDevices([]));
    refresh();
    media.addEventListener("devicechange", refresh);
    return () => media.removeEventListener("devicechange", refresh);
  }, []);
  return devices;
}

/** Whether the OpenCode server has an OpenAI API key, the only credential voice can use. */
function useOpenAIKey(connectionID: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["voice", "openai-key", connectionID],
    enabled: Boolean(connectionID) && enabled,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const response = await openCodeClient(connectionID ?? undefined).integration.get(
        { integrationID: "openai" },
        { signal },
      );
      return response.data.connections.some(
        (connection) => connection.type === "env" || connection.method === "key",
      );
    },
  });
}

export function VoiceSettings() {
  const [preferences, setPreferences] = useAtom(voicePreferencesAtom);
  const runtime = useAtomValue(runtimeAtom);
  const navigate = useNavigate();
  const microphones = useMicrophones();
  const supported = supportsOpenCodeVoice(runtime?.version);
  const key = useOpenAIKey(runtime?.connected ? runtime.connectionID : null, supported);
  const voiceLabel =
    VOICE_OPTIONS.find((option) => option.id === preferences.voice)?.label ?? preferences.voice;
  const microphoneLabel =
    microphones.find((device) => device.deviceId === preferences.inputDeviceID)?.label ||
    (preferences.inputDeviceID ? "Unavailable microphone" : "System default");
  const shortcutLabel =
    GLOBAL_SHORTCUTS.find((option) => option.value === preferences.globalShortcut)?.label ?? "Off";

  return (
    <>
      <SettingsSection
        title="Voice chat"
        description="Talk with a task's agent through a voice assistant. Palot uses OpenAI GPT-Live through your OpenCode server; voice minutes are billed to that server's OpenAI API key."
        icon={Mic}
      >
        {!supported ? (
          <SettingsNotice status="warning">
            Voice chat needs OpenCode 2.0.32 or later. This connection runs{" "}
            {runtime?.version ?? "an unknown version"}.
          </SettingsNotice>
        ) : key.data === false ? (
          <SettingsNotice
            status="warning"
            actions={
              <Button
                size="sm"
                variant="outline"
                onClick={() => void navigate({ to: "/settings/providers" })}
              >
                <KeyRound aria-hidden="true" data-icon="inline-start" />
                Open Providers
              </Button>
            }
          >
            Add an OpenAI API key to start voice chats. ChatGPT sign-in works for tasks, but OpenAI
            doesn't allow it for voice sessions.
          </SettingsNotice>
        ) : null}
        <SettingsGroup>
          <SettingsRow
            title="Voice"
            description="Used for new voice chats."
            control={
              <Select
                value={preferences.voice}
                onValueChange={(value) =>
                  setPreferences((current) => ({ ...current, voice: String(value) }))
                }
              >
                <SelectTrigger className="w-full @lg/settings:w-48" aria-label="Voice">
                  <SelectValue>{voiceLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  {VOICE_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                      <span className="ml-2 text-meta text-muted-foreground">
                        {option.description}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="Microphone"
            description="Changes apply to an ongoing voice chat right away."
            control={
              <Select
                value={preferences.inputDeviceID ?? "default"}
                onValueChange={(value) => {
                  const inputDeviceID = value === "default" ? null : String(value);
                  setPreferences((current) => ({ ...current, inputDeviceID }));
                  void voiceCall.selectInputDevice(inputDeviceID);
                }}
              >
                <SelectTrigger className="w-full @lg/settings:w-56" aria-label="Microphone">
                  <SelectValue>{microphoneLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="default">System default</SelectItem>
                  {microphones.map((device, index) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="Greeting"
            description="The assistant opens each voice chat with a short hello."
            control={
              <Switch
                aria-label="Greeting"
                checked={preferences.greeting}
                onCheckedChange={(checked) =>
                  setPreferences((current) => ({ ...current, greeting: Boolean(checked) }))
                }
              />
            }
          />
          <SettingsRow
            title="Floating controls"
            description="Keep a small call window above other apps while Palot isn't focused."
            control={
              <Switch
                aria-label="Floating controls"
                checked={preferences.overlay}
                onCheckedChange={(checked) =>
                  setPreferences((current) => ({ ...current, overlay: Boolean(checked) }))
                }
              />
            }
          />
          <SettingsRow
            title="System-wide shortcut"
            description="Start or end a voice chat in the open task from any app."
            control={
              <Select
                value={preferences.globalShortcut ?? "off"}
                onValueChange={(value) =>
                  setPreferences((current) => ({
                    ...current,
                    globalShortcut: value === "off" ? null : String(value),
                  }))
                }
              >
                <SelectTrigger
                  className="w-full @lg/settings:w-44"
                  aria-label="System-wide shortcut"
                >
                  <SelectValue>{shortcutLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  {GLOBAL_SHORTCUTS.map((option) => (
                    <SelectItem key={option.value ?? "off"} value={option.value ?? "off"}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </SettingsGroup>
      </SettingsSection>
      <VoiceCoordinatorSettings />
    </>
  );
}
