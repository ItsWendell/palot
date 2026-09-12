const REQUEST_TIMEOUT_MS = 30_000;

export function openCodeRequestSignal(
  outer?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return outer ? AbortSignal.any([outer, timeout]) : timeout;
}
