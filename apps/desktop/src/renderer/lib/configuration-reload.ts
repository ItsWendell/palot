import type { QueryClient } from "@tanstack/react-query";
import { palot } from "../services/palot";
import { openCodeKeys } from "./opencode-query";

/**
 * Reloads OpenCode's configuration, then re-reads the connection's mounted views. The
 * `location.shutdown` events a reload causes only mark reads stale, so catalogs, settings
 * and models refresh here, where the change is known. Inbox row branches are outside the
 * connection prefix and stay put.
 */
export async function reloadOpenCodeConfiguration(
  queryClient: QueryClient,
  connectionID: string,
): Promise<void> {
  await palot.reloadConfiguration(connectionID);
  await queryClient.invalidateQueries({ queryKey: openCodeKeys.all(connectionID) });
}
