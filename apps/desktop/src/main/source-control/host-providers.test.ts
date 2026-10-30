// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { GitLabProvider } from "./gitlab-provider";
import { ForgejoProvider } from "./forgejo-provider";
import { BitbucketProvider } from "./bitbucket-provider";
import { parseHostRemote, parseHostPullRequestUrl, type RestHostOptions } from "./host-provider";

const sha = "a".repeat(40);
const ref = { host: "gitlab.example", repository: "group/sub/repo", number: 7 };
function fixture(
  respond: (path: string, method: string, body: Record<string, unknown> | undefined) => unknown,
) {
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    expect(init?.redirect).toBe("error");
    const url = new URL(String(input));
    expect(init?.headers).toMatchObject({
      authorization: `${url.pathname.startsWith("/api/v1/") ? "token" : "Bearer"} dummy`,
    });
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = `${url.pathname}${url.search}`;
    calls.push({ path, method, body });
    const result = respond(path, method, body);
    return result instanceof Response ? result : Response.json(result);
  });
  const options: RestHostOptions = {
    account: {
      host: ref.host,
      url: `https://${ref.host}`,
      kind: "gitlab",
      source: "env",
      configured: true,
    },
    credentials: { token: vi.fn(async () => "dummy") },
    emit: vi.fn(),
    syncLinks: vi.fn(),
    fetch,
  };
  return { options, calls };
}
describe("code host routing and operations", () => {
  it("parses nested GitLab namespaces, SSH URLs and provider-specific review links", () => {
    expect(parseHostRemote("git@gitlab.example:group/sub/repo.git")).toEqual({
      host: ref.host,
      repository: ref.repository,
    });
    expect(parseHostRemote("ssh://git@gitlab.example:2222/group/sub/repo.git")).toEqual({
      host: ref.host,
      repository: ref.repository,
    });
    expect(
      parseHostPullRequestUrl("https://gitlab.example/group/sub/repo/-/merge_requests/7/diffs"),
    ).toEqual(ref);
    expect(parseHostPullRequestUrl("https://codeberg.org/a/b/pulls/8")).toMatchObject({
      repository: "a/b",
      number: 8,
    });
    expect(parseHostPullRequestUrl("https://bitbucket.org/a/b/pull-requests/8")).toMatchObject({
      repository: "a/b",
      number: 8,
    });
    expect(parseHostRemote("file:///tmp/repo")).toBeNull();
    expect(
      parseHostPullRequestUrl("https://user:secret@gitlab.example/g/r/-/merge_requests/1"),
    ).toBeNull();
  });
  it("creates GitLab merge requests, maps pipelines, comments, approves and merges with a head precondition", async () => {
    let state = "opened";
    const { options, calls } = fixture((path, method, body) => {
      if (path === "/api/v4/user") return { id: 1, username: "viewer" };
      if (path.endsWith("/merge") && method === "PUT") {
        expect(body).toMatchObject({ sha });
        if (!body?.merge_when_pipeline_succeeds) state = "merged";
        return {};
      }
      if (path.endsWith("/merge_requests") && method === "POST") return { iid: 7 };
      if (method === "POST") return {};
      return {
        iid: 7,
        title: "Feature",
        state,
        source_branch: "feature",
        target_branch: "main",
        sha,
        author: { id: 2, username: "author" },
        head_pipeline: { id: 3, status: "success", sha },
        detailed_merge_status: "mergeable",
      };
    });
    const provider = new GitLabProvider(options);
    expect(
      await provider.create(ref, "feature", {
        profileID: "p",
        sessionID: "s",
        base: "main",
        title: "Feature",
        body: "Body",
        draft: true,
      }),
    ).toEqual(ref);
    expect(calls[0]).toMatchObject({
      path: "/api/v4/projects/group%2Fsub%2Frepo/merge_requests",
      body: { title: "Draft: Feature", source_branch: "feature", target_branch: "main" },
    });
    const detail = await provider.detail(ref);
    expect(detail).toMatchObject({
      checks: "passing",
      checkRuns: [{ name: "Pipeline #3", conclusion: "success" }],
      headOid: sha,
      viewer: { isAuthor: false, canUpdate: true },
    });
    await provider.comment({ ...ref, body: "Comment" });
    await provider.review({ ...ref, body: "", event: "approve", comments: [], commitOid: sha });
    await provider.setAutoMerge({ ...ref, enabled: true, method: "squash" });
    expect(calls).toContainEqual(
      expect.objectContaining({ path: expect.stringMatching(/\/approve$/), body: { sha } }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        path: expect.stringMatching(/\/merge$/),
        body: { sha, squash: true, merge_when_pipeline_succeeds: true },
      }),
    );
    expect((await provider.merge({ ...ref, method: "merge", expectedHeadOid: sha })).state).toBe(
      "merged",
    );
    await expect(
      provider.review({
        ...ref,
        body: "",
        event: "approve",
        comments: [{ path: "x", line: 1, side: "RIGHT", body: "x" }],
        commitOid: sha,
      }),
    ).rejects.toMatchObject({ code: "unsupported-action" });
  });
  it("never treats incomplete Forgejo statuses as an all-passing watch", async () => {
    const { options } = fixture((path) =>
      path === "/api/v1/user"
        ? { login: "viewer" }
        : path.includes("/status?")
          ? { statuses: [{ context: "build", status: "success" }], total_count: 101 }
          : path.includes("/comments?")
            ? []
            : {
                number: 7,
                title: "Feature",
                state: "open",
                head: { ref: "feature", sha },
                base: { ref: "main" },
                mergeable: true,
              },
    );
    const provider = new ForgejoProvider({
      ...options,
      account: { ...options.account, kind: "forgejo" },
    });
    expect((await provider.detail(ref)).mergeState).toBe("clean");
    expect((await provider.watch(ref)).detail).toMatchObject({
      checksComplete: false,
      checks: [{ name: "build", status: "success" }],
    });
  });
  it("does not report an older GitLab pipeline as passing for the current head", async () => {
    const { options } = fixture((path) =>
      path === "/api/v4/user"
        ? { id: 1, username: "viewer" }
        : {
            iid: 7,
            title: "Feature",
            state: "opened",
            sha,
            source_branch: "feature",
            target_branch: "main",
            head_pipeline: { id: 3, sha: "b".repeat(40), status: "success" },
          },
    );
    expect(await new GitLabProvider(options).detail(ref)).toMatchObject({
      checks: "pending",
      checksComplete: false,
    });
  });
  it("keeps Bitbucket merge disabled rather than racing the reviewed-head check", async () => {
    const { options } = fixture(() => {
      throw new Error("must not call API");
    });
    const provider = new BitbucketProvider({
      ...options,
      account: {
        ...options.account,
        host: "bitbucket.org",
        url: "https://bitbucket.org",
        kind: "bitbucket",
      },
    });
    await expect(
      provider.merge({ ...ref, method: "merge", expectedHeadOid: sha }),
    ).rejects.toMatchObject({ code: "unsupported-action" });
    expect(options.fetch).not.toHaveBeenCalled();
  });
  it("publishes and reviews Forgejo PRs, pinning the merge to the reviewed head", async () => {
    let merged = false;
    const forgeRef = { ...ref, repository: "group/repo" };
    const { options, calls } = fixture((path, method, body) => {
      if (path.endsWith("/merge") && method === "POST") {
        expect(body).toMatchObject({ Do: "squash", head_commit_id: sha });
        merged = true;
        return {};
      }
      if (path === "/api/v1/user") return { login: "viewer" };
      if (path.includes("/status?")) return { statuses: [], total_count: 0 };
      if (path.includes("/comments?")) return [];
      return {
        number: 7,
        title: "Feature",
        state: "open",
        merged,
        head: { ref: "feature", sha },
        base: { ref: "main" },
        mergeable: true,
      };
    });
    const provider = new ForgejoProvider({
      ...options,
      account: { ...options.account, kind: "forgejo" },
    });
    expect(
      await provider.create(forgeRef, "feature", {
        profileID: "p",
        sessionID: "s",
        base: "main",
        title: "Feature",
        body: "Body",
        draft: false,
      }),
    ).toEqual(forgeRef);
    await provider.comment({ ...forgeRef, body: "A comment" });
    await provider.review({
      ...forgeRef,
      body: "Needs work",
      event: "request-changes",
      comments: [],
      commitOid: sha,
    });
    expect(calls).toContainEqual(
      expect.objectContaining({
        path: expect.stringMatching(/\/reviews$/),
        body: expect.objectContaining({ event: "REQUEST_CHANGES", commit_id: sha }),
      }),
    );
    expect(
      (await provider.merge({ ...forgeRef, method: "squash", expectedHeadOid: sha })).state,
    ).toBe("merged");
  });
  it("lists, creates, comments, approves and watches Bitbucket requests with build statuses", async () => {
    const bbRef = { host: "bitbucket.org", repository: "workspace/repo", number: 7 };
    const row = {
      id: 7,
      title: "Feature",
      state: "OPEN",
      source: { branch: { name: "feature" }, commit: { hash: sha } },
      destination: { branch: { name: "main" } },
    };
    const { options, calls } = fixture((path, method) => {
      if (path.includes("/statuses/build?"))
        return { values: [{ key: "pipeline", name: "Build", state: "SUCCESSFUL" }] };
      if (path.includes("/comments?"))
        return { values: [{ id: 2, content: { raw: "A comment" } }] };
      if (path.includes("/pullrequests?")) return { values: [row] };
      if (method === "POST" && !path.endsWith("/pullrequests")) return {};
      return row;
    });
    const provider = new BitbucketProvider({
      ...options,
      account: {
        ...options.account,
        host: bbRef.host,
        url: "https://bitbucket.org",
        kind: "bitbucket",
      },
    });
    expect(
      (await provider.search({ list: "authored", query: "repo:workspace/repo" })).items[0]?.number,
    ).toBe(7);
    expect(
      await provider.create(bbRef, "feature", {
        profileID: "p",
        sessionID: "s",
        base: "main",
        title: "Feature",
        body: "Body",
        draft: false,
      }),
    ).toEqual(bbRef);
    await provider.comment({ ...bbRef, body: "A comment" });
    await provider.review({ ...bbRef, body: "", event: "approve", comments: [], commitOid: sha });
    const watch = await provider.watch(bbRef);
    expect(watch.snapshot.checks).toBe("passing");
    expect(watch.detail).toMatchObject({ checksComplete: true, remarksComplete: true });
    expect(calls).toContainEqual(
      expect.objectContaining({
        path: "/2.0/repositories/workspace/repo/pullrequests/7/approve",
        method: "POST",
      }),
    );
  });
  it("does not expose host error bodies or tokens", async () => {
    const { options } = fixture(() => new Response("reflected secret dummy", { status: 401 }));
    await expect(new GitLabProvider(options).defaultBranch(ref)).rejects.toThrow("HTTP 401");
    await expect(new GitLabProvider(options).defaultBranch(ref)).rejects.not.toThrow("secret");
  });
});
