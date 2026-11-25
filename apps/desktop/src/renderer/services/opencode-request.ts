const REQUEST_TIMEOUT_MS = 30_000;
/** Slash commands can run shell steps and plugin code before OpenCode responds. */
export const COMMAND_TIMEOUT_MS = 10 * 60_000;
/** Creation runs the project's setup command before responding (often dependency installs). */
export const WORKTREE_CREATE_TIMEOUT_MS = 10 * 60_000;
export const VCS_INIT_TIMEOUT_MS = 60_000;

const SLOW_MUTATIONS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^\/api\/session\/[^/]+\/command$/, COMMAND_TIMEOUT_MS],
  [/^\/api\/worktree$/, WORKTREE_CREATE_TIMEOUT_MS],
  [/^\/api\/vcs\/init$/, VCS_INIT_TIMEOUT_MS],
];

export function openCodeRequestSignal(
  outer?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return outer ? AbortSignal.any([outer, timeout]) : timeout;
}

/**
 * The transport's own deadline for a request. It must not be shorter than the budget a caller
 * gives a slow mutation, or that longer budget never applies.
 */
export function openCodeTransportTimeoutMs(method: string, pathname: string): number {
  if (method !== "POST") return REQUEST_TIMEOUT_MS;
  return SLOW_MUTATIONS.find(([path]) => path.test(pathname))?.[1] ?? REQUEST_TIMEOUT_MS;
}
