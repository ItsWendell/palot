import { useState } from "react";
import { useAtomValue } from "jotai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { runtimeAtom } from "../atoms/workspace";
import { disabledProfileIDsAtom } from "../atoms/connections";
import { useConnectionOverview } from "./use-connection-overview";
import { projectsQueryOptions } from "../lib/session-catalog-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { mapProject } from "../services/opencode-mappers";

export function useSettingsServer(enabled: boolean) {
  const selected = useAtomValue(runtimeAtom);
  const [profileID, setProfileID] = useState(() => selected?.profileID ?? null);
  const { connections } = useConnectionOverview();
  const disabled = useAtomValue(disabledProfileIDsAtom);
  const entry = connections.find((connection) => connection.profile.id === profileID);
  // The initial runtime can precede registry hydration, but another profile is never a fallback.
  const owner = entry?.runtime ?? (selected?.profileID === profileID ? selected : null);
  const available = Boolean(
    owner && !disabled.includes(owner.profileID) && canFetchOpenCode(owner),
  );
  const runtime = owner && !available ? { ...owner, connected: false } : owner;
  const queryClient = useQueryClient();
  const projects = useQuery({
    ...projectsQueryOptions(queryClient, runtime?.connectionID ?? "disconnected"),
    enabled: enabled && available,
  });
  return {
    profileID,
    setProfileID,
    runtime,
    available,
    status:
      profileID && disabled.includes(profileID) ? "Disabled" : available ? "Connected" : "Offline",
    profiles: connections.map(({ profile }) => ({ id: profile.id, name: profile.name })),
    projects: (runtime ? projects.data?.map(mapProject) : undefined) ?? entry?.projects ?? [],
    projectError: projects.error,
    projectsPending: projects.isPending && available,
  };
}
