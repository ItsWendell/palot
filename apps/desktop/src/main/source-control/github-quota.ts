/** The share of each quota a background read leaves for a user's next click. */
export const GITHUB_RESERVE_RATIO = 0.1;
/** Pause used when GitHub rate limits without saying for how long. */
const DEFAULT_PAUSE_MS = 60_000;

export type GitHubPriority = "interactive" | "background";

interface QuotaSnapshot {
  limit: number;
  remaining: number;
  resetAt: number;
}

export class GitHubRateLimitPausedError extends Error {
  constructor(
    readonly host: string,
    readonly retryAt: number,
  ) {
    super(`GitHub is rate limited for ${host} until ${new Date(retryAt).toISOString()}.`);
    this.name = "GitHubRateLimitPausedError";
  }
}

export type HeaderReader = { get(name: string): string | null };

/**
 * Tracks GitHub's own `x-ratelimit-*` balance per credential and quota resource (`core`,
 * `graphql`, `search`) and keeps the last tenth for interactive requests: a background sweep
 * that would dip below it is refused until the quota resets. Interactive requests may spend the
 * reserve but not a quota GitHub already reported empty. A rate-limit answer pauses background
 * work for the credential until `retry-after` or the reset, instead of failing every read.
 *
 * Nothing is debited locally: GitHub's count already includes what `gh` or an agent spent with
 * the same token, and a 304 or a request that never reached GitHub spends nothing.
 */
export class GitHubQuota {
  private readonly snapshots = new Map<string, QuotaSnapshot>();
  private readonly pauses = new Map<string, number>();
  /** Admitted requests whose answer has not updated the balance yet. */
  private readonly inFlight = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Admits one request and reserves a unit of its quota until the returned release runs, so
   * concurrent requests cannot all pass the same balance. Throws `GitHubRateLimitPausedError`
   * when the request must wait. A background request is admitted only if the reserve stays
   * whole after it; an interactive one only while GitHub has budget left.
   */
  admit(scope: string, resource: string, priority: GitHubPriority): () => void {
    const now = this.now();
    const pausedUntil = this.pauses.get(scope);
    if (pausedUntil !== undefined) {
      if (pausedUntil <= now) this.pauses.delete(scope);
      else if (priority === "background") throw new GitHubRateLimitPausedError(scope, pausedUntil);
    }
    const id = key(scope, resource);
    const snapshot = this.snapshots.get(id);
    if (snapshot && snapshot.resetAt > now) {
      const available = snapshot.remaining - (this.inFlight.get(id) ?? 0);
      const allowed =
        priority === "interactive"
          ? available >= 1
          : available - 1 >= Math.ceil(snapshot.limit * GITHUB_RESERVE_RATIO);
      if (!allowed) throw new GitHubRateLimitPausedError(scope, snapshot.resetAt);
    }
    this.inFlight.set(id, (this.inFlight.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.inFlight.get(id) ?? 1) - 1;
      if (count > 0) this.inFlight.set(id, count);
      else this.inFlight.delete(id);
    };
  }

  observe(scope: string, headers: HeaderReader): void {
    const resource = headers.get("x-ratelimit-resource")?.trim();
    const limit = Number(headers.get("x-ratelimit-limit"));
    const remaining = Number(headers.get("x-ratelimit-remaining"));
    const reset = Number(headers.get("x-ratelimit-reset"));
    if (
      !resource ||
      !Number.isFinite(limit) ||
      limit <= 0 ||
      !Number.isFinite(remaining) ||
      remaining < 0 ||
      !Number.isFinite(reset)
    )
      return;
    const next = { limit, remaining, resetAt: reset * 1_000 };
    const previous = this.snapshots.get(key(scope, resource));
    // The latest answer wins within a window; an answer from an older window says nothing.
    if (previous && next.resetAt < previous.resetAt) return;
    this.snapshots.set(key(scope, resource), next);
  }

  /** Records a rate-limit answer and returns when the pause ends. */
  pause(scope: string, headers: HeaderReader | null): number {
    const now = this.now();
    const retryAt = (headers && retryAtFrom(headers, now)) ?? now + DEFAULT_PAUSE_MS;
    this.pauses.set(scope, Math.max(this.pauses.get(scope) ?? 0, retryAt));
    return retryAt;
  }

  pausedUntil(scope: string): number | null {
    const until = this.pauses.get(scope);
    return until !== undefined && until > this.now() ? until : null;
  }

  /** The latest pause of any credential for a host, for status displays. */
  hostPausedUntil(host: string): number | null {
    let latest: number | null = null;
    for (const [scope, until] of this.pauses) {
      if (!scope.startsWith(`${host}:`) || until <= this.now()) continue;
      latest = Math.max(latest ?? 0, until);
    }
    return latest;
  }
}

export function retryAtFrom(headers: HeaderReader, now: number): number | null {
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1_000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(now, date);
  }
  const reset = Number(headers.get("x-ratelimit-reset")) * 1_000;
  return Number.isFinite(reset) && reset > now ? reset : null;
}

function key(scope: string, resource: string): string {
  return `${scope}\0${resource}`;
}
