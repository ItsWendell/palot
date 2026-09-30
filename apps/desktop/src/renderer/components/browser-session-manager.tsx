import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import type { PalotSession } from "../../shared";
import { experimentalBrowserAtom } from "../atoms/ui";
import { useWorkbenchScope } from "../atoms/workbench";
import { useSessionCatalogSelector } from "../hooks/use-session-catalog";
import { BrowserSessionAttachment } from "../hooks/use-browser-session";
import type { WorkbenchScope } from "../lib/workbench-tabs";
import { workbenchScopeKey } from "../lib/workbench-tabs";

type Attachment = {
  scope: WorkbenchScope;
  location: Pick<PalotSession, "location">["location"];
  connectionID: string;
};

function sameLocation(left: Attachment["location"] | null, right: Attachment["location"] | null) {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.directory === right.directory &&
      left.workspaceID === right.workspaceID)
  );
}

/** Lives under the runtime layout, not the route outlet that owns the visible workspace. */
export function BrowserSessionManager({
  connectionID,
  profileID,
  sessionID,
}: {
  connectionID: string;
  profileID: string;
  sessionID: string | null;
}) {
  const selectLocation = useCallback(
    (sessions: PalotSession[]) =>
      sessions.find((session) => session.id === sessionID)?.location ?? null,
    [sessionID],
  );
  const location = useSessionCatalogSelector(selectLocation, sameLocation);
  const enabled = useAtomValue(experimentalBrowserAtom);
  const [visited, setVisited] = useState<Attachment[]>([]);
  useEffect(() => {
    if (!enabled) {
      setVisited([]);
      return;
    }
    if (!sessionID || !location) return;
    const scope = { profileID, sessionID };
    const key = workbenchScopeKey(scope);
    setVisited((current) => {
      const existing = current.find((attachment) => workbenchScopeKey(attachment.scope) === key);
      if (!existing) return [...current, { scope, location, connectionID }];
      return sameLocation(existing.location, location)
        ? current
        : current.map((attachment) =>
            attachment === existing ? { scope, location, connectionID } : attachment,
          );
    });
  }, [connectionID, enabled, location, profileID, sessionID]);

  return visited.map((attachment) => (
    <ManagedAttachment
      key={workbenchScopeKey(attachment.scope)}
      attachment={attachment}
      active={sessionID === attachment.scope.sessionID}
    />
  ));
}

function ManagedAttachment({ attachment, active }: { attachment: Attachment; active: boolean }) {
  const context = useWorkbenchScope(attachment.scope);
  return (
    <BrowserSessionAttachment
      scope={attachment.scope}
      location={attachment.location}
      connectionID={attachment.connectionID}
      context={context}
      active={active}
    />
  );
}
