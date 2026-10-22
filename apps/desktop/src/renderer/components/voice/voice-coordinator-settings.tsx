import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { Network } from "lucide-react";
import { runtimeAtom } from "../../atoms/workspace";
import { useSelectedSession } from "../../hooks/use-session-catalog";
import { supportsOpenCodeVoice } from "../../lib/voice/voice-support";
import { coordinatorAvailable } from "../../services/voice-call";
import { SettingsGroup, SettingsNotice, SettingsRow, SettingsSection } from "../settings-layout";
import { CopyField } from "../ui/copy-field";

/**
 * Explains and checks the optional voice coordinator: an OpenCode plugin that adds a
 * `voice-coordinator` agent able to start and steer other tasks. OpenCode 2.0.32 can
 * only enable local plugins through the `plugins` config entry, so Palot shows the
 * exact entry instead of editing the user's configuration.
 */
export function VoiceCoordinatorSettings() {
  const runtime = useAtomValue(runtimeAtom);
  const selected = useSelectedSession();
  const supported = supportsOpenCodeVoice(runtime?.version);
  const local = runtime?.capabilities?.localPathActions === true;
  const directory = selected?.location.directory ?? null;
  const plugin = useQuery({
    queryKey: ["voice", "coordinator-plugin"],
    queryFn: async () => (await window.palot?.voice?.coordinatorPluginDirectory()) ?? null,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const active = useQuery({
    queryKey: ["voice", "coordinator-agent", runtime?.connectionID ?? null, directory],
    enabled: supported && Boolean(runtime?.connected && directory),
    staleTime: 15_000,
    queryFn: () => coordinatorAvailable(runtime!.connectionID, directory!),
  });
  const entry = plugin.data ? `"plugins": [${JSON.stringify(plugin.data)}]` : null;

  return (
    <SettingsSection
      title="Voice coordinator"
      description="Optional. Start a voice chat that can create, steer, and check on several tasks for you, like a project lead you talk to. Use Start coordinator voice chat in the command palette."
      icon={Network}
    >
      {!supported ? null : !directory ? (
        <SettingsNotice status="neutral">
          Open a task to check whether the coordinator is available there.
        </SettingsNotice>
      ) : active.data ? (
        <SettingsNotice status="success">
          The coordinator is available. New coordinator chats start in the open task's project.
        </SettingsNotice>
      ) : active.isFetched ? (
        <SettingsNotice status="info">
          {local
            ? "Add the entry below to your global OpenCode configuration (~/.config/opencode/opencode.jsonc), then restart the OpenCode service."
            : "This connection is remote. Copy the plugin folder to the server's machine and add its path to that machine's OpenCode configuration."}
        </SettingsNotice>
      ) : null}
      <SettingsGroup>
        <SettingsRow
          title="Plugin location"
          description={
            entry
              ? "OpenCode loads plugins from a folder. Merge this into an existing plugins list."
              : "This build doesn't include the coordinator plugin."
          }
          control={
            entry ? (
              <CopyField
                value={entry}
                label="OpenCode plugins entry"
                className="w-full @lg/settings:w-96"
              />
            ) : null
          }
        />
      </SettingsGroup>
    </SettingsSection>
  );
}
