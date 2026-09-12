export async function resolveActiveSessions<T>(
  sessionIDs: string[],
  getSession: (sessionID: string) => Promise<T>,
  isNotFound: (error: unknown) => boolean,
): Promise<T[]> {
  const results = await Promise.allSettled(sessionIDs.map((sessionID) => getSession(sessionID)));
  const failed = results.find(
    (result): result is PromiseRejectedResult =>
      result.status === "rejected" && !isNotFound(result.reason),
  );
  if (failed) throw failed.reason;
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}
