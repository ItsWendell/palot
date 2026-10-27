/**
 * Location-wide MCP elicitations: forms an MCP server opens to ask the user for input.
 *
 * OpenCode owns these by location, not session. Their `sessionID` is the `"global"` owner,
 * so session request lists never include them, and an MCP call waits until someone answers.
 * Like OpenCode desktop, Palot lists them for the task's location and shows them with the
 * task's own requests.
 */

import type { FormInfo } from "@opencode/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { PalotEvent } from "../../shared";
import { openCodeKeys } from "../lib/opencode-query";
import { formView, type PendingRequestView } from "../lib/view-models";
import { openCodeClient } from "../services/opencode-client";
import { MCP_ELICITATION_OWNER, palot } from "../services/palot";

export function isMcpElicitation(form: Pick<FormInfo, "sessionID" | "metadata">): boolean {
  return form.sessionID === MCP_ELICITATION_OWNER && form.metadata?.kind === "mcp-elicitation";
}

/** Whether `event` creates or settles a location-wide form. */
export function isGlobalFormEvent(event: PalotEvent): boolean {
  if (event.type === "form.created") return event.data.form.sessionID === MCP_ELICITATION_OWNER;
  if (event.type === "form.replied" || event.type === "form.cancelled")
    return event.data.sessionID === MCP_ELICITATION_OWNER;
  return event.type === "server.connected";
}

export function mcpElicitationQueryKey(connectionID: string, directory: string) {
  return [...openCodeKeys.all(connectionID), "mcp-elicitations", directory] as const;
}

export function useMcpElicitations(
  connectionID: string | undefined,
  directory: string | undefined,
  enabled = true,
): Array<PendingRequestView & { sessionID: string }> {
  const queryClient = useQueryClient();
  const active = Boolean(enabled && connectionID && directory);
  const query = useQuery({
    queryKey: mcpElicitationQueryKey(connectionID ?? "", directory ?? ""),
    enabled: active,
    queryFn: async ({ signal }) => {
      const result = await openCodeClient(connectionID).form.list(
        { location: { directory: directory! } },
        { signal },
      );
      return result.data.filter(isMcpElicitation);
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  useEffect(() => {
    if (!active) return;
    return palot.subscribe((batch) => {
      if (batch.connectionID !== connectionID || !batch.events.some(isGlobalFormEvent)) return;
      void queryClient.invalidateQueries({
        queryKey: mcpElicitationQueryKey(connectionID!, directory!),
        exact: true,
      });
    });
  }, [active, connectionID, directory, queryClient]);

  return useMemo(
    () =>
      (query.data ?? []).map((form, index) => ({
        ...formView(form, index),
        // Elicitations always render as forms, never as the agent's question card.
        type: "form" as const,
        sessionID: MCP_ELICITATION_OWNER,
        locationDirectory: directory,
      })),
    [directory, query.data],
  );
}
