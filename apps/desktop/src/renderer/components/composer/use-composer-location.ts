import { useState } from "react";
import type { OpenCodeRuntimeStatus, PalotProject, PalotSession } from "../../../shared";
import { useCacheSession } from "../../hooks/use-session-catalog";
import { useSessionLocationMissing } from "../../hooks/use-session-location-missing";
import { projectForSession } from "../../lib/view-models";

/**
 * Whether the task's workspace folder still exists. A failed send can reveal a missing folder
 * before the periodic check does, so the composer reports its failures here.
 */
export function useComposerLocation({
  session,
  projects,
  runtime,
  newTask,
  draftScope,
}: {
  session: PalotSession;
  projects: PalotProject[];
  runtime: OpenCodeRuntimeStatus | null;
  newTask: boolean;
  draftScope: string;
}) {
  const cacheSession = useCacheSession();
  const [failure, setFailure] = useState<{ scope: string; error: unknown } | null>(null);
  const options = {
    session,
    project: projectForSession(projects, session) ?? null,
    owner: runtime,
    enabled: !newTask,
    error: failure?.scope === draftScope ? failure.error : undefined,
    onRecovered: cacheSession,
  };
  const recovery = useSessionLocationMissing(options);
  return {
    options,
    recovery,
    missing: recovery.missing,
    reportFailure: (error: unknown) => setFailure({ scope: draftScope, error }),
  };
}

export type ComposerLocation = ReturnType<typeof useComposerLocation>;
