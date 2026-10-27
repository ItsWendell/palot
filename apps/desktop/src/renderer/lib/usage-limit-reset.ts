/**
 * When a provider limit lifts. OpenCode 2.1.2+ records how long the provider asked to wait
 * (`retryAfterMs`) on usage and rate-limit failures, counted from when the failure was
 * recorded. Mirrors OpenCode desktop's usage-limit dialog.
 */

/** Waits longer than this are treated as bogus provider data. */
const MAX_RETRY_AFTER_MS = 7 * 86_400_000;

const LIMIT_TITLES: Record<string, string> = {
  "provider.free-limit": "Free usage limit reached",
  "provider.quota": "Usage limit reached",
  "provider.rate-limit": "Rate limited",
};

/** A clearer heading than "Response failed" for usage and rate-limit failures. */
export function usageLimitTitle(type: string | null | undefined): string | null {
  return (type && LIMIT_TITLES[type]) || null;
}

/** The time the limit resets, or null when the provider gave no usable wait. */
export function usageLimitResetAt(
  failedAt: number,
  retryAfterMs: number | null | undefined,
): number | null {
  if (
    typeof retryAfterMs !== "number" ||
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs < 0 ||
    retryAfterMs > MAX_RETRY_AFTER_MS ||
    !Number.isFinite(failedAt)
  )
    return null;
  return failedAt + retryAfterMs;
}

/** "Try again after 14:05." (or with a date when the reset is not today), null when unknown. */
export function usageLimitResetText(
  failedAt: number,
  retryAfterMs: number | null | undefined,
  now = Date.now(),
  locale?: string,
): string | null {
  const at = usageLimitResetAt(failedAt, retryAfterMs);
  if (at === null) return null;
  if (at <= now) return "The limit has reset; you can try again.";
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  const time = new Intl.DateTimeFormat(
    locale,
    sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(at);
  return `Try again after ${time}.`;
}
