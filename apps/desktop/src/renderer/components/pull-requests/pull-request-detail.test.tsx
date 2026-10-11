import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PullRequestDetail,
  PullRequestTimelineItem,
} from "../../../shared/source-control-contract";
import { shortcutPlatform } from "../../lib/keyboard-shortcuts";
import { renderPullRequestsPage } from "./page-test-support";
import {
  pullRequestMergeMethodsAtom,
  pullRequestTimelineFiltersAtom,
} from "./pull-request-preferences";
import { installSourceControl, person, pullRequestDetail, timelineComment } from "./test-fixtures";

const ref = { host: "github.com", repository: "acme/web", number: 7 };

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "palot");
  window.localStorage.clear();
});

function renderDetail(
  detail: Partial<PullRequestDetail> = {},
  overrides: Parameters<typeof installSourceControl>[0] = {},
  store = createStore(),
) {
  const bridge = installSourceControl({
    pullRequestDetail: async () => ({ ok: true, value: pullRequestDetail(7, detail) }),
    ...overrides,
  });
  return { ...bridge, ...renderPullRequestsPage({ pr: "github.com/acme/web/7", store }) };
}

describe("pull request summary", () => {
  it("groups checks failing, running, passing with required and incomplete notes", async () => {
    renderDetail({
      checksComplete: false,
      checkRuns: [
        {
          name: "lint",
          workflow: "CI",
          status: "completed",
          conclusion: "success",
          required: false,
          url: null,
          startedAt: 0,
          completedAt: 65_000,
        },
        {
          name: "unit",
          workflow: "CI",
          status: "completed",
          conclusion: "failure",
          required: true,
          url: "https://github.com/acme/web/actions/1",
          startedAt: 0,
          completedAt: 3_000,
        },
        {
          name: "e2e",
          workflow: null,
          status: "in-progress",
          conclusion: null,
          required: false,
          url: null,
          startedAt: null,
          completedAt: null,
        },
      ],
    });
    const checks = await screen.findByRole("region", { name: "Checks" });
    const groups = within(checks).getAllByRole("list");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Failing checks",
      "Running checks",
      "Passing checks",
    ]);
    expect(within(groups[0]!).getByText("Required")).toBeTruthy();
    expect(groups[0]!.textContent).toContain("Failed · 3s");
    expect(groups[2]!.textContent).toContain("Passed · 1m 05s");
    expect(within(checks).getByText("1 failing, 1 running, 1 passing")).toBeTruthy();
    expect(within(checks).getByText(/This list is incomplete/)).toBeTruthy();
  });

  it("shows reviewers with their states and requests new ones", async () => {
    const { api } = renderDetail({
      reviewers: [
        { name: "alice", person: person("alice"), isTeam: false, state: "approved" },
        { name: "acme/core", person: null, isTeam: true, state: "requested" },
      ],
      assignees: [person("bob")],
    });
    const reviewers = await screen.findByRole("region", { name: "Reviewers" });
    expect(within(reviewers).getByText("Approved")).toBeTruthy();
    expect(within(reviewers).getByText("Awaiting review")).toBeTruthy();
    await userEvent.click(within(reviewers).getByRole("button", { name: "Request reviewers" }));
    await userEvent.click(await screen.findByRole("button", { name: "bob" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Reviewer login or team" }), "@carol");
    await userEvent.click(screen.getByRole("button", { name: "Request" }));
    await waitFor(() =>
      expect(api.requestPullRequestReviewers).toHaveBeenCalledWith({
        ...ref,
        reviewers: ["bob", "carol"],
      }),
    );
  });

  it.each([
    [{ state: "draft", mergeState: "draft" }, "still a draft"],
    [{ mergeState: "blocked" }, "blocked until required reviews and checks pass"],
    [{ mergeState: "behind" }, "out of date with main"],
    [{ mergeState: "dirty", mergeable: "conflicting" }, "conflicts with main"],
    [
      {
        viewer: {
          login: "me",
          canMerge: false,
          canUpdate: false,
          isAuthor: false,
          reviewState: null,
        },
      },
      "don't have permission",
    ],
  ] as const)("disables merging with a clear reason (%o)", async (detail, reason) => {
    renderDetail(detail as Partial<PullRequestDetail>);
    const merge = await screen.findByRole("region", { name: "Merge" });
    const button = within(merge).getByRole("button", { name: /merge/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(within(merge).getByText(new RegExp(reason))).toBeTruthy();
  });

  it("warns about unstable checks without blocking", async () => {
    renderDetail({ mergeState: "unstable" });
    const merge = await screen.findByRole("region", { name: "Merge" });
    expect(within(merge).getByText(/Some checks are failing/)).toBeTruthy();
    expect(
      (within(merge).getByRole("button", { name: "Create a merge commit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("merges with the remembered method and the head the user saw, after confirming", async () => {
    const store = createStore();
    store.set(pullRequestMergeMethodsAtom, { "github.com/acme/web": "rebase" });
    const { api } = renderDetail(
      { headOid: "seen-head", autoMerge: { method: "squash" } },
      {},
      store,
    );
    const merge = await screen.findByRole("region", { name: "Merge" });
    expect(within(merge).getByText(/Auto-merge is on \(squash and merge\)/)).toBeTruthy();
    await userEvent.click(within(merge).getByRole("button", { name: "Rebase and merge" }));
    expect(api.mergePullRequest).not.toHaveBeenCalled();
    await userEvent.click(within(merge).getByRole("button", { name: "Confirm rebase and merge" }));
    await waitFor(() =>
      expect(api.mergePullRequest).toHaveBeenCalledWith({
        ...ref,
        method: "rebase",
        expectedHeadOid: "seen-head",
      }),
    );
  });

  it("explains a merge refused because the head moved", async () => {
    renderDetail(
      {},
      {
        mergePullRequest: async () => ({
          ok: false,
          error: { code: "merge-head-moved" as never, message: "Head moved" },
        }),
      },
    );
    const merge = await screen.findByRole("region", { name: "Merge" });
    await userEvent.click(within(merge).getByRole("button", { name: "Create a merge commit" }));
    await userEvent.click(
      within(merge).getByRole("button", { name: "Confirm create a merge commit" }),
    );
    expect((await within(merge).findByRole("alert")).textContent).toContain(
      "New commits were pushed since you loaded this pull request",
    );
  });

  it("renders the description as markdown, or says there is none", async () => {
    renderDetail({ body: "" });
    expect(await screen.findByText("No description.")).toBeTruthy();
  });
});

describe("pull request header", () => {
  it("converts to draft, closes after confirming, refreshes, and shows viewed counts", async () => {
    const writeClipboardText = vi.fn(async () => undefined);
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { writeClipboardText },
    });
    const { api } = renderDetail(
      {},
      {
        pullRequestFiles: async () => ({
          ok: true,
          value: {
            headOid: "abc1234def",
            truncated: false,
            files: [
              {
                path: "a.ts",
                previousPath: null,
                status: "modified",
                additions: 1,
                deletions: 0,
                patch: null,
                viewed: "viewed",
              },
              {
                path: "b.ts",
                previousPath: null,
                status: "added",
                additions: 1,
                deletions: 0,
                patch: null,
                viewed: "unviewed",
              },
            ],
          },
        }),
      },
    );
    expect(await screen.findByRole("tab", { name: "Code 1 of 2 viewed" })).toBeTruthy();

    const menu = () => screen.getByRole("button", { name: "Pull request actions" });
    await userEvent.click(menu());
    await userEvent.click(await screen.findByRole("menuitem", { name: "Convert to draft" }));
    await waitFor(() =>
      expect(api.setPullRequestDraft).toHaveBeenCalledWith({ ...ref, draft: true }),
    );

    // The draft result replaced the cached detail, so the menu now offers Ready for review.
    await userEvent.click(menu());
    expect(await screen.findByRole("menuitem", { name: "Ready for review" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "Close pull request" }));
    expect(api.setPullRequestState).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("menuitem", { name: "Confirm close" }));
    await waitFor(() =>
      expect(api.setPullRequestState).toHaveBeenCalledWith({ ...ref, state: "closed" }),
    );

    await userEvent.click(menu());
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
    await waitFor(() =>
      expect(writeClipboardText).toHaveBeenCalledWith("https://github.com/acme/web/pull/7"),
    );
    const reads = api.pullRequestDetail.mock.calls.length;
    await userEvent.click(menu());
    await userEvent.click(await screen.findByRole("menuitem", { name: "Refresh" }));
    await waitFor(() => expect(api.pullRequestDetail.mock.calls.length).toBeGreaterThan(reads));
  });

  it("shows a specific error when the pull request cannot be read", async () => {
    installSourceControl({
      pullRequestDetail: async () => ({
        ok: false,
        error: { code: "github-not-found", message: "Not Found" },
      }),
    });
    renderPullRequestsPage({ pr: "github.com/acme/web/7" });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "GitHub could not find this pull request",
    );
  });
});

describe("pull request timeline", () => {
  const thread = (
    id: string,
    resolved: boolean,
  ): Extract<PullRequestTimelineItem, { kind: "review-thread" }> => ({
    kind: "review-thread",
    id,
    path: "src/app.ts",
    line: 12,
    isResolved: resolved,
    isOutdated: false,
    viewerCanResolve: true,
    viewerCanReply: true,
    createdAt: 2,
    comments: [
      {
        id: `${id}-c1`,
        author: person("alice"),
        body: `Thread ${id} body`,
        path: "src/app.ts",
        line: 12,
        startLine: null,
        side: "RIGHT",
        diffHunk: "@@ -1,2 +1,2 @@\n-old line\n+new line",
        createdAt: 2,
        url: "https://github.com/acme/web/pull/7#r1",
      },
    ],
  });

  async function openTimeline(store = createStore()) {
    const bridge = renderDetail(
      {},
      {
        pullRequestTimeline: async () => ({
          ok: true,
          value: {
            nextCursor: null,
            items: [
              timelineComment("human", "Looks good to me", person("carol")),
              timelineComment("bot", "Coverage report", person("codecov[bot]", true)),
              thread("open-thread", false),
              thread("done-thread", true),
              {
                kind: "commit",
                id: "c1",
                oid: "0123456789",
                message: "Fix tests\n\nbody",
                author: person("carol"),
                createdAt: 3,
              },
              {
                kind: "event",
                id: "e1",
                type: "labeled",
                actor: person("carol"),
                detail: "bug",
                createdAt: 4,
              },
            ],
          },
        }),
      },
      store,
    );
    await userEvent.click(await screen.findByRole("tab", { name: "Timeline" }));
    await screen.findByRole("list", { name: "Timeline" });
    return bridge;
  }

  it("renders every kind of item and filters bots and resolved threads persistently", async () => {
    const store = createStore();
    await openTimeline(store);
    expect(screen.getByText("Looks good to me")).toBeTruthy();
    expect(screen.getByText("Coverage report")).toBeTruthy();
    expect(screen.getAllByRole("article", { name: "Review thread on src/app.ts:12" })).toHaveLength(
      2,
    );
    expect(screen.getAllByText("+new line")).toHaveLength(2);
    expect(screen.getByText("Fix tests")).toBeTruthy();
    expect(screen.getByText("added the bug label")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Hide bots" }));
    expect(screen.queryByText("Coverage report")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Hide resolved" }));
    expect(screen.queryByText("Thread done-thread body")).toBeNull();
    expect(screen.getByText("Thread open-thread body")).toBeTruthy();
    expect(screen.getByText("2 hidden")).toBeTruthy();
    expect(store.get(pullRequestTimelineFiltersAtom)).toEqual({
      hideBots: true,
      hideResolved: true,
    });
  });

  it("replies, resolves, and comments with Mod+Enter", async () => {
    const { api } = await openTimeline();
    const mod = shortcutPlatform() === "mac" ? { metaKey: true } : { ctrlKey: true };
    const open = screen.getByText("Thread open-thread body").closest("article")!;
    await userEvent.click(within(open).getByRole("button", { name: "Resolve" }));
    await waitFor(() =>
      expect(api.resolvePullRequestThread).toHaveBeenCalledWith({
        ...ref,
        threadID: "open-thread",
        resolved: true,
      }),
    );
    const done = screen.getByText("Thread done-thread body").closest("article")!;
    await userEvent.click(within(done).getByRole("button", { name: "Unresolve" }));
    await waitFor(() =>
      expect(api.resolvePullRequestThread).toHaveBeenLastCalledWith({
        ...ref,
        threadID: "done-thread",
        resolved: false,
      }),
    );

    await userEvent.click(within(open).getByRole("button", { name: "Reply" }));
    const reply = within(open).getByRole("textbox", { name: "Reply on src/app.ts:12" });
    await userEvent.type(reply, "Fixed in 0123");
    fireEvent.keyDown(reply, { key: "Enter", ...mod });
    await waitFor(() =>
      expect(api.replyToPullRequestThread).toHaveBeenCalledWith({
        ...ref,
        threadID: "open-thread",
        body: "Fixed in 0123",
      }),
    );

    const composer = screen.getByRole("textbox", { name: "Add a comment" });
    await userEvent.type(composer, "Ship it");
    fireEvent.keyDown(composer, { key: "Enter", ...mod });
    await waitFor(() =>
      expect(api.addPullRequestComment).toHaveBeenCalledWith({ ...ref, body: "Ship it" }),
    );
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe(""));
  });
});
