/**
 * When a provider limit lifts, and what to call it. OpenCode 2.1.2+ records how long the provider
 * asked to wait (`retryAfterMs`) on usage and rate-limit failures, counted from when the failure
 * was recorded; Console budgets name their reset in the response body. The limit kinds themselves
 * live in `shared/provider-limit.ts`, so the main process names them the same way.
 */

import type { JsonValue, PalotMessage } from "../../shared";
import { providerLimit, providerLimitError, type ProviderLimit } from "../../shared/provider-limit";

/** OpenCode types an empty balance as `provider.quota` but answers it with HTTP 402; it never resets. */
export function outOfCredits(type: string | null | undefined, status?: number | null): boolean {
  return type === "provider.quota" && status === 402;
}

/**
 * A clearer heading than "Response failed" for usage, budget, rate-limit and balance failures.
 * `body` is the provider's response body, where OpenCode Console names the Go window.
 */
export function usageLimitTitle(
  type: string | null | undefined,
  status?: number | null,
  body?: string | null,
): string | null {
  return providerLimit({ type, status, body }, Number.NaN)?.title ?? null;
}

/** A usage or rate limit that lifts on its own, so waiting for it (or its reset time) means something. */
export function resettingLimit(type: string | null | undefined, status?: number | null): boolean {
  return providerLimit({ type, status }, Number.NaN)?.resets ?? false;
}

/** The limit a failed step or turn hit, from its message's recorded error. */
export function messageLimit(
  message: Pick<PalotMessage, "data" | "createdAt" | "completedAt"> | undefined,
): ProviderLimit | null {
  if (!message) return null;
  const data = message.data;
  const error =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, JsonValue>).error
      : undefined;
  return providerLimit(providerLimitError(error), message.completedAt ?? message.createdAt);
}

/**
 * The limit that failed the last turn, or null when it did not fail on one. Anything the user
 * sent since then clears it.
 */
export function lastMessageLimit(messages: readonly PalotMessage[]): ProviderLimit | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.type === "user") return null;
    const limit = messageLimit(message);
    if (limit) return limit;
  }
  return null;
}

/** Two limits that read the same, so a component fed a fresh copy need not re-render. */
export function sameLimit(left: ProviderLimit | null, right: ProviderLimit | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.kind === right.kind &&
      left.title === right.title &&
      left.resetsAt === right.resetsAt &&
      left.link?.url === right.link?.url)
  );
}

/** "Usage limit reached · retrying in 40s (attempt 2)"; the countdown only while it runs. */
export function usageLimitRetryLabel(
  title: string,
  attempt: number | null,
  seconds?: number | null,
): string {
  const when = seconds && seconds > 0 ? ` in ${seconds}s` : "";
  return `${title} · retrying${when}${attempt === null ? "" : ` (attempt ${attempt})`}`;
}

/** The time the limit resets, or null when the provider gave no usable wait. */
export function usageLimitResetAt(
  failedAt: number,
  retryAfterMs: number | null | undefined,
): number | null {
  // Only the wait matters here: a plain rate limit reads it the same way as every limit.
  return providerLimit({ type: "provider.rate-limit", retryAfterMs }, failedAt)?.resetsAt ?? null;
}

/** "Try again after 14:05." (or with a date when the reset is not today), null when unknown. */
export function usageLimitResetText(
  failedAt: number,
  retryAfterMs: number | null | undefined,
  now = Date.now(),
  locale?: string,
): string | null {
  return limitResetText(usageLimitResetAt(failedAt, retryAfterMs), now, locale);
}

/** "Try again after 14:05." for a known reset time, null when unknown. */
export function limitResetText(at: number | null, now = Date.now(), locale?: string) {
  if (at === null || !Number.isFinite(at)) return null;
  if (at <= now) return "The limit has reset; you can try again.";
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  const time = new Intl.DateTimeFormat(
    locale,
    sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(at);
  return `Try again after ${time}.`;
}

/** "Resets at 14:05." (with a date when not today), for a limit OpenCode is still retrying. */
export function usageLimitResetsText(at: number | null, now = Date.now(), locale?: string) {
  if (at === null || !Number.isFinite(at) || at <= now) return null;
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  const time = new Intl.DateTimeFormat(
    locale,
    sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(at);
  return `Resets at ${time}.`;
}
