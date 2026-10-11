// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { GitHubApiError, GitHubClient } from "./github-client";
import { GitHubQuota, GitHubRateLimitPausedError } from "./github-quota";

const SCOPE = "github.com:abc";
const TOKEN = "secret-token-value";

function quotaHeaders(remaining: number, limit = 5_000, resetSeconds = 2_000) {
  return new Headers({
    "x-ratelimit-resource": "graphql",
    "x-ratelimit-limit": String(limit),
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": String(resetSeconds),
  });
}

function client(fetch: typeof globalThis.fetch, now = () => 1_000_000, concurrency?: number) {
  const quota = new GitHubQuota(now);
  const credentials = {
    get: vi.fn(async (host: string) => ({
      host,
      token: TOKEN,
      source: "env" as const,
      fingerprint: SCOPE,
    })),
    invalidate: vi.fn(),
  };
  return {
    quota,
    credentials,
    github: new GitHubClient({
      credentials,
      quota,
      fetch,
      ...(concurrency === undefined ? {} : { concurrency }),
    }),
  };
}

describe("GitHub quota reserve", () => {
  it("keeps the last tenth of a quota for interactive requests", () => {
    const quota = new GitHubQuota(() => 1_000_000);
    quota.observe(SCOPE, quotaHeaders(499));
    expect(() => quota.admit(SCOPE, "graphql", "background")).toThrow(GitHubRateLimitPausedError);
    expect(() => quota.admit(SCOPE, "graphql", "interactive")).not.toThrow();
    // Other quotas and credentials are tracked on their own.
    expect(() => quota.admit(SCOPE, "core", "background")).not.toThrow();
    expect(() => quota.admit("github.com:other", "graphql", "background")).not.toThrow();

    quota.observe(SCOPE, quotaHeaders(0));
    expect(() => quota.admit(SCOPE, "graphql", "interactive")).toThrow(GitHubRateLimitPausedError);
  });

  it("refuses background work that would dip into the reserve, counting requests in flight", () => {
    const quota = new GitHubQuota(() => 1_000_000);
    quota.observe(SCOPE, quotaHeaders(500));
    // Spending one more would leave 499 of a 500 reserve.
    expect(() => quota.admit(SCOPE, "graphql", "background")).toThrow(GitHubRateLimitPausedError);

    quota.observe(SCOPE, quotaHeaders(502, 5_000, 2_001));
    const first = quota.admit(SCOPE, "graphql", "background");
    quota.admit(SCOPE, "graphql", "background");
    // Two requests are already spending the last two units above the reserve.
    expect(() => quota.admit(SCOPE, "graphql", "background")).toThrow(GitHubRateLimitPausedError);
    first();
    expect(() => quota.admit(SCOPE, "graphql", "background")).not.toThrow();
  });

  it("admits again once the window resets and ignores answers from an older window", () => {
    let now = 1_000_000;
    const quota = new GitHubQuota(() => now);
    quota.observe(SCOPE, quotaHeaders(10, 5_000, 2_000));
    quota.observe(SCOPE, quotaHeaders(4_000, 5_000, 1_500));
    expect(() => quota.admit(SCOPE, "graphql", "background")).toThrow();
    now = 2_000_001;
    expect(() => quota.admit(SCOPE, "graphql", "background")).not.toThrow();
  });
});

describe("GitHubClient", () => {
  it("pauses background reads after a rate limit instead of hammering GitHub", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          status: 403,
          headers: { "x-ratelimit-remaining": "0", "retry-after": "60" },
        }),
    );
    const { github, quota } = client(fetch as unknown as typeof globalThis.fetch);
    const error = await github
      .graphql({ host: "github.com", query: "{ viewer { login } }", priority: "background" })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error).toMatchObject({ code: "rate-limited", options: { retryAt: 1_060_000 } });
    expect(String((error as Error).message)).not.toContain(TOKEN);
    expect(quota.pausedUntil(SCOPE)).toBe(1_060_000);

    await expect(
      github.graphql({ host: "github.com", query: "{ viewer { login } }", priority: "background" }),
    ).rejects.toMatchObject({ code: "rate-limited" });
    expect(fetch).toHaveBeenCalledTimes(1);
    // A user's click still reaches GitHub.
    await github
      .graphql({ host: "github.com", query: "{ viewer { login } }", priority: "interactive" })
      .catch(() => undefined);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("runs at most eight requests at once", async () => {
    let active = 0;
    let peak = 0;
    const fetch = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    });
    const { github } = client(fetch as unknown as typeof globalThis.fetch);
    await Promise.all(
      Array.from({ length: 20 }, () =>
        github.graphql({ host: "github.com", query: "{ ok }", priority: "background" }),
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(20);
    expect(peak).toBe(8);
  });

  it("revalidates REST reads with ETags and serves a 304 from cache", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("if-none-match") === '"v1"') return new Response(null, { status: 304 });
      return new Response(JSON.stringify([{ number: 7 }]), {
        status: 200,
        headers: { etag: '"v1"' },
      });
    });
    const { github } = client(fetch);
    const first = await github.rest<Array<{ number: number }>>({
      host: "github.com",
      path: "repos/a/b/pulls",
      priority: "interactive",
    });
    const second = await github.rest<Array<{ number: number }>>({
      host: "github.com",
      path: "repos/a/b/pulls",
      priority: "interactive",
    });
    expect(first).toMatchObject({ notModified: false, data: [{ number: 7 }] });
    expect(second).toMatchObject({ notModified: true, data: [{ number: 7 }] });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/a/b/pulls");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("drops a refused token so the next read asks its source again", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 401 }));
    const { github, credentials } = client(fetch as unknown as typeof globalThis.fetch);
    await expect(
      github.graphql({ host: "github.com", query: "{ ok }", priority: "interactive" }),
    ).rejects.toMatchObject({ code: "auth" });
    expect(credentials.invalidate).toHaveBeenCalledWith("github.com");
  });

  it("rechecks a queued request against a pause set while it waited for a slot", async () => {
    let resolveFirst!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { github } = client(fetch as unknown as typeof globalThis.fetch, () => 1_000_000, 1);
    const first = github
      .graphql({ host: "github.com", query: "{ a }", priority: "background" })
      .catch((error: unknown) => error);
    const queued = github
      .graphql({ host: "github.com", query: "{ b }", priority: "background" })
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    resolveFirst(new Response("{}", { status: 429, headers: { "retry-after": "60" } }));
    await expect(first).resolves.toMatchObject({ code: "rate-limited" });
    await expect(queued).resolves.toMatchObject({ code: "rate-limited" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the data of a partially failed GraphQL answer with errors by alias", async () => {
    const body = {
      data: { pr0: { pullRequest: { number: 1 } }, pr1: null },
      errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository", path: ["pr1"] }],
    };
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const { github } = client(fetch as unknown as typeof globalThis.fetch);
    await expect(
      github.graphqlPartial({ host: "github.com", query: "{ ... }", priority: "background" }),
    ).resolves.toEqual({
      data: body.data,
      errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository", path: ["pr1"] }],
    });
    // The strict variant still fails, so single reads report a missing PR.
    await expect(
      github.graphql({ host: "github.com", query: "{ ... }", priority: "background" }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("maps refused permissions and validation failures with GitHub's own messages", async () => {
    const answers = [
      new Response(JSON.stringify({ message: "Resource not accessible by integration" }), {
        status: 403,
      }),
      new Response(
        JSON.stringify({
          message: "Validation Failed",
          errors: [{ message: "Review cannot request changes on your own pull request" }],
        }),
        { status: 422 },
      ),
      new Response(
        JSON.stringify({
          data: null,
          errors: [{ type: "FORBIDDEN", message: "Viewer not authorized" }],
        }),
        { status: 200 },
      ),
    ];
    const fetch = vi.fn(async () => answers.shift()!);
    const { github } = client(fetch as unknown as typeof globalThis.fetch);
    const request = {
      host: "github.com",
      path: "repos/a/b/pulls/1/reviews",
      method: "POST" as const,
      body: {},
      priority: "interactive" as const,
    };
    await expect(github.rest(request)).rejects.toMatchObject({
      code: "forbidden",
      options: { status: 403 },
    });
    await expect(github.rest(request)).rejects.toMatchObject({
      code: "validation",
      message: expect.stringContaining("Review cannot request changes on your own pull request"),
      options: {
        githubMessages: [
          "Validation Failed",
          "Review cannot request changes on your own pull request",
        ],
      },
    });
    await expect(
      github.graphql({ host: "github.com", query: "mutation { x }", priority: "interactive" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
