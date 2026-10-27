import { ClientError } from "@opencode/client";

/**
 * Whether a client call failed because the server has no such route: a server older than the
 * pinned client. OpenCode answers unknown routes with an empty 404, which the generated client
 * reports as `UnsupportedContentType` rather than a status (verified against 2.1.4 with the
 * 2.2.0 client). Real route errors are JSON, so they never match.
 */
export function isMissingOpenCodeRoute(error: unknown): boolean {
  if (!(error instanceof ClientError)) return false;
  if (error.reason === "UnsupportedContentType") return true;
  return (
    error.reason === "UnexpectedStatus" &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "status" in error.cause &&
    error.cause.status === 404
  );
}
