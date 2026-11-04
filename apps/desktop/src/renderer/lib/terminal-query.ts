import type { PersistentPtyInfo } from "@opencode/client";
import type { QueryClient } from "@tanstack/react-query";
import { openCodeKeys } from "./opencode-query";

/** A terminal's name: the user's title when renamed, else OpenCode's automatic title. */
export function terminalDisplayName(
  terminal: { title?: string; userTitle?: string | null },
  fallback = "Terminal",
): string {
  return terminal.userTitle || terminal.title || fallback;
}

/**
 * Writes a terminal's latest info into its session's cached terminal list. A list that has
 * not seen the terminal yet is re-read instead of guessing where it belongs.
 */
export function syncTerminalInfo(
  queryClient: QueryClient,
  connectionID: string,
  terminal: PersistentPtyInfo,
): void {
  const queryKey = openCodeKeys.sessionTerminals(connectionID, terminal.sessionID);
  const terminals = queryClient.getQueryData<PersistentPtyInfo[]>(queryKey);
  if (!terminals) return;
  if (!terminals.some((candidate) => candidate.id === terminal.id)) {
    void queryClient.invalidateQueries({ queryKey, exact: true });
    return;
  }
  queryClient.setQueryData<PersistentPtyInfo[]>(queryKey, (current) =>
    current?.map((candidate) => (candidate.id === terminal.id ? terminal : candidate)),
  );
}
