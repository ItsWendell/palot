import { queryOptions, useQueries, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import type {
  PalotSettingsSnapshot,
  OpenCodeRuntimeStatus,
  SettingsCapability,
  SettingsLocationInput,
} from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { palot } from "../services/palot";
import { ALL_SETTINGS_CAPABILITIES } from "../services/opencode-settings";

export function settingsSnapshotQueryOptions(
  connectionID: string,
  input: SettingsLocationInput,
  enabled = true,
) {
  return queryOptions({
    queryKey: openCodeKeys.settingsSnapshot(connectionID, input),
    queryFn: ({ signal }) => palot.loadSettings({ ...input, connectionID }, signal),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function useSettingsSnapshot(
  input: SettingsLocationInput | null,
  enabled = true,
  owner?: OpenCodeRuntimeStatus | null,
) {
  const selectedRuntime = useAtomValue(runtimeAtom);
  const runtime = owner === undefined ? selectedRuntime : owner;
  const capabilities = input ? [...new Set(input.capabilities ?? ALL_SETTINGS_CAPABILITIES)] : [];
  const queries = useQueries({
    queries: capabilities.map((capability) =>
      settingsSnapshotQueryOptions(
        runtime?.connectionID ?? "disconnected",
        { ...input!, capabilities: [capability] },
        Boolean(enabled && canFetchOpenCode(runtime)),
      ),
    ),
  });
  const snapshots = new Map(
    capabilities.map((capability, index) => [capability, queries[index]?.data]),
  );
  return {
    data: combineSnapshots(snapshots),
    isPending: queries.every((query) => query.isPending),
    isFetching: queries.some((query) => query.isFetching),
    error: queries.find((query) => query.error)?.error ?? null,
    pendingCapabilities: capabilities.filter((_, index) => queries[index]?.isPending),
    refetch: () => Promise.all(queries.map((query) => query.refetch())),
  };
}

export function useCheckPlugins(
  input: SettingsLocationInput,
  owner?: OpenCodeRuntimeStatus | null,
) {
  const selectedRuntime = useAtomValue(runtimeAtom);
  const runtime = owner === undefined ? selectedRuntime : owner;
  const connectionID = input.connectionID ?? runtime?.connectionID ?? "disconnected";
  const queryClient = useQueryClient();
  const queryKey = openCodeKeys.settingsSnapshot(connectionID, {
    ...input,
    capabilities: ["plugins"],
  });
  return async () => {
    if (!canFetchOpenCode(runtime) || runtime?.connectionID !== connectionID)
      throw new Error("This settings server is disconnected");
    // A list started before this check must not overwrite its update metadata.
    await queryClient.cancelQueries({ queryKey, exact: true });
    const before = queryClient.getQueryState(queryKey);
    const plugins = await palot.checkPlugins({ ...input, connectionID });
    // Invalidation, refetch, and removal replace the query state even when the
    // inventory data is structurally unchanged. Never replace that newer work.
    if (queryClient.getQueryState(queryKey) !== before || before?.fetchStatus === "fetching")
      return;
    queryClient.setQueryData(
      queryKey,
      combineSnapshots(
        new Map([
          [
            "plugins",
            {
              location: {
                directory: input.directory,
                ...(input.workspaceID ? { workspaceID: input.workspaceID } : {}),
              },
              plugins,
              errors: plugins.flatMap((plugin) =>
                plugin.state.status === "failed"
                  ? [
                      {
                        capability: "plugins",
                        label: "Plugins",
                        message: plugin.state.error,
                        ...(plugin.state.ref ? { reference: plugin.state.ref } : {}),
                      },
                    ]
                  : [],
              ),
            },
          ],
        ]),
      ),
    );
  };
}

function combineSnapshots(
  snapshots: ReadonlyMap<
    SettingsCapability,
    (Partial<PalotSettingsSnapshot> & Pick<PalotSettingsSnapshot, "location">) | undefined
  >,
): PalotSettingsSnapshot | undefined {
  const first = [...snapshots.values()].find((snapshot) => snapshot !== undefined);
  if (!first) return undefined;
  return {
    location: first.location,
    catalog: snapshots.get("catalog")?.catalog ?? {
      models: [],
      defaultModel: null,
      providers: [],
      errors: [],
    },
    configSources: snapshots.get("config")?.configSources ?? [],
    agents: snapshots.get("agents")?.agents ?? [],
    integrations: snapshots.get("integrations")?.integrations ?? [],
    mcpServers: snapshots.get("mcp")?.mcpServers ?? [],
    mcpResources: snapshots.get("mcpResources")?.mcpResources ?? [],
    mcpResourceTemplates: snapshots.get("mcpResources")?.mcpResourceTemplates ?? [],
    savedPermissions: snapshots.get("savedPermissions")?.savedPermissions ?? [],
    plugins: snapshots.get("plugins")?.plugins ?? [],
    skills: snapshots.get("skills")?.skills ?? [],
    commands: snapshots.get("commands")?.commands ?? [],
    references: snapshots.get("references")?.references ?? [],
    websearchProviders: snapshots.get("websearchProviders")?.websearchProviders ?? [],
    errors: [...snapshots.values()].flatMap((snapshot) => snapshot?.errors ?? []),
  };
}
