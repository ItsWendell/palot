import type { PersistentPtyInfo } from "@opencode/client";
import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { syncTerminalInfo, terminalDisplayName } from "../lib/terminal-query";
import { showErrorToast } from "../lib/toast-error";
import type { WorkbenchTab } from "../lib/workbench-tabs";
import { listSessionTerminals, renamePty } from "../services/opencode-pty";

type TerminalTab = Extract<WorkbenchTab, { kind: "terminal" }>;

export function sessionTerminalsQueryOptions(
  connectionID: string,
  sessionID: string,
  enabled: boolean,
) {
  return queryOptions({
    queryKey: openCodeKeys.sessionTerminals(connectionID, sessionID),
    queryFn: ({ signal }) => listSessionTerminals(sessionID, connectionID, signal),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Sets or clears a terminal's user title, showing a new title at once. The current title, or
 * clearing a terminal that was never renamed, sends nothing.
 */
export async function renameSessionTerminal(
  queryClient: QueryClient,
  connectionID: string,
  terminal: PersistentPtyInfo,
  title: string | null,
): Promise<void> {
  if (
    title === terminalDisplayName(terminal, "") ||
    (title === null && terminal.userTitle === null)
  )
    return;
  // A cleared title shows whatever automatic title OpenCode falls back to, known only from its answer.
  if (title !== null)
    syncTerminalInfo(queryClient, connectionID, { ...terminal, title, userTitle: title });
  try {
    syncTerminalInfo(queryClient, connectionID, await renamePty(terminal.id, title, connectionID));
  } catch (error) {
    const current = queryClient
      .getQueryData<PersistentPtyInfo[]>(
        openCodeKeys.sessionTerminals(connectionID, terminal.sessionID),
      )
      ?.find((candidate) => candidate.id === terminal.id);
    // A newer title from the server or another rename stays.
    if (title !== null && current?.userTitle === title)
      syncTerminalInfo(queryClient, connectionID, terminal);
    showErrorToast("Could not rename terminal", error);
  }
}

/**
 * A workbench terminal's name and rename action, read from its session's terminal list so the tab
 * matches Running work and follows renames from other clients. Legacy terminals cannot be renamed.
 */
export function useWorkbenchTerminal(tab: TerminalTab): {
  label: string;
  rename?: { value: string; save(title: string | null): void };
} {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const { profileID, ptyID, sessionID, transport } = tab.resource;
  const connectionID =
    runtime?.connected && runtime.profileID === profileID && runtime.connectionID !== "preview"
      ? runtime.connectionID
      : null;
  const query = useQuery({
    ...sessionTerminalsQueryOptions(
      connectionID ?? "disconnected",
      sessionID ?? "",
      Boolean(connectionID && sessionID && transport === "persistent"),
    ),
    select: (terminals) => terminals.find((terminal) => terminal.id === ptyID) ?? null,
  });
  const terminal = connectionID ? query.data : null;
  if (!terminal || !connectionID) return { label: "Terminal" };
  const label = terminalDisplayName(terminal);
  return {
    label,
    rename: {
      value: label,
      save: (title) => void renameSessionTerminal(queryClient, connectionID, terminal, title),
    },
  };
}
