import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { composerDraftAtomFamily } from "../../atoms/ui";
import { composerScope } from "../../lib/composer-scope";
import { project, renderPullRequestsPage, task } from "./page-test-support";
import {
  EMPTY_PULL_REQUEST_FILTERS,
  pullRequestFiltersAtom,
  pullRequestListWidthAtom,
  pullRequestMergeMethodsAtom,
} from "./pull-request-preferences";
import { parsePullRequestParam } from "./pull-request-ref";
import {
  installSourceControl,
  pullRequest,
  pullRequestDetail,
  pullRequestLink,
  searchPages,
  sourceControlStatus,
} from "./test-fixtures";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "palot");
  window.localStorage.clear();
});

const rows = () => screen.getAllByRole("button", { name: /^#\d+ / });

describe("PullRequestsPage list", () => {
  it("shows the five sections with counts, linked tasks, empty states, and Load more", async () => {
    const { api } = installSourceControl({
      searchPullRequests: searchPages({
        "review-requested": {
          "": { items: [pullRequest(5, { title: "Add billing", author: "hubot" })], next: "c2" },
          c2: { items: [pullRequest(6, { title: "Second page" })] },
        },
        "recently-merged": { "": { items: [pullRequest(2, { state: "merged" })] } },
      }),
      listPullRequestLinks: async () => ({ ok: true, value: [pullRequestLink(task.id, 5)] }),
    });
    renderPullRequestsPage();
    for (const name of ["Review requested", "Assigned", "Authored", "Mentioned", "Recently merged"])
      expect(await screen.findByRole("region", { name })).toBeTruthy();
    const review = screen.getByRole("region", { name: "Review requested" });
    const row = await within(review).findByRole("button", { name: /^#5 Add billing/ });
    expect(row.getAttribute("aria-label")).toContain("by hubot");
    expect(row.textContent).toContain("Fix login");
    expect(await screen.findByText("Nothing is assigned to you.")).toBeTruthy();

    await userEvent.click(within(review).getByRole("button", { name: "Load more" }));
    expect(await within(review).findByRole("button", { name: /^#6 Second page/ })).toBeTruthy();
    expect(api.searchPullRequests).toHaveBeenCalledWith({
      list: "review-requested",
      limit: 25,
      cursor: "c2",
    });
  });

  it("sends the debounced search text to every list", async () => {
    const { api } = installSourceControl();
    renderPullRequestsPage();
    await waitFor(() => expect(api.searchPullRequests).toHaveBeenCalledTimes(5));
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search pull requests" }),
      "label:bug",
    );
    await waitFor(() =>
      expect(api.searchPullRequests).toHaveBeenCalledWith(
        expect.objectContaining({ list: "mentioned", query: "label:bug" }),
      ),
    );
    // One request per list for the settled text, not one per keystroke.
    expect(
      api.searchPullRequests.mock.calls.filter(([input]) => input.query !== undefined),
    ).toHaveLength(5);
  });

  it("narrows every list with saved filters, shown as removable chips", async () => {
    const { api } = installSourceControl();
    const store = createStore();
    store.set(pullRequestFiltersAtom, {
      ...EMPTY_PULL_REQUEST_FILTERS,
      repositories: ["acme/web"],
      hideDrafts: true,
    });
    renderPullRequestsPage({ store });
    await waitFor(() =>
      expect(api.searchPullRequests).toHaveBeenCalledWith(
        expect.objectContaining({ list: "authored", query: "repo:acme/web draft:false" }),
      ),
    );
    const chips = screen.getByRole("list", { name: "Active filters" });
    await userEvent.click(within(chips).getByRole("button", { name: "Remove filter acme/web" }));
    await waitFor(() =>
      expect(api.searchPullRequests).toHaveBeenCalledWith(
        expect.objectContaining({ list: "authored", query: "draft:false" }),
      ),
    );
    await userEvent.click(within(chips).getByRole("button", { name: "Remove filter No drafts" }));
    expect(store.get(pullRequestFiltersAtom)).toEqual(EMPTY_PULL_REQUEST_FILTERS);
    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
  });

  it("resizes the list from its border and keeps the width", async () => {
    installSourceControl();
    const store = createStore();
    renderPullRequestsPage({ store });
    const handle = await screen.findByRole("separator", { name: "Resize pull request list" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(store.get(pullRequestListWidthAtom)).toBe(376);
    fireEvent.keyDown(handle, { key: "End" });
    expect(store.get(pullRequestListWidthAtom)).toBe(640);
    fireEvent.doubleClick(handle);
    expect(store.get(pullRequestListWidthAtom)).toBe(360);
  });

  it("selects through the pr search param and moves through rows with the keyboard", async () => {
    const { api } = installSourceControl({
      searchPullRequests: searchPages({
        "review-requested": { "": { items: [pullRequest(5), pullRequest(6)] } },
        authored: { "": { items: [pullRequest(9)] } },
      }),
    });
    const { router } = renderPullRequestsPage({ pr: "github.com/acme/web/6" });
    await waitFor(() =>
      expect(api.pullRequestDetail).toHaveBeenCalledWith({
        host: "github.com",
        repository: "acme/web",
        number: 6,
      }),
    );
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.getByRole("button", { name: /^#6 / }).getAttribute("aria-current")).toBe("true");

    const first = screen.getByRole("button", { name: /^#5 / });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^#6 /);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    // Crosses into the next section.
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^#9 /);
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(parsePullRequestParam((router.state.location.search as { pr?: string }).pr)).toEqual({
        host: "github.com",
        repository: "acme/web",
        number: 9,
      }),
    );
    expect(await screen.findByRole("region", { name: /^#9 / })).toBeTruthy();
  });

  it("reveals quick actions while Shift is held and confirms them in place", async () => {
    const { api } = installSourceControl({
      searchPullRequests: searchPages({
        "review-requested": { "": { items: [pullRequest(5)] } },
      }),
      pullRequestDetail: async (ref) => ({
        ok: true,
        value: pullRequestDetail(ref.number, {
          headOid: "head-5",
          mergeMethods: ["merge", "squash"],
        }),
      }),
    });
    const store = createStore();
    store.set(pullRequestMergeMethodsAtom, { "github.com/acme/web": "squash" });
    renderPullRequestsPage({ store });
    const group = await screen.findByRole("group", { name: "Quick actions for #5" });
    expect(group.hasAttribute("data-visible")).toBe(false);
    act(() => void fireEvent.keyDown(window, { key: "Shift" }));
    expect(group.hasAttribute("data-visible")).toBe(true);

    await userEvent.click(within(group).getByRole("button", { name: "Approve #5" }));
    await userEvent.click(within(group).getByRole("button", { name: "Confirm approve #5" }));
    await waitFor(() =>
      expect(api.submitPullRequestReview).toHaveBeenCalledWith(
        expect.objectContaining({ event: "approve", commitOid: "head-5", number: 5 }),
      ),
    );
    await userEvent.click(within(group).getByRole("button", { name: "Merge #5" }));
    await userEvent.click(within(group).getByRole("button", { name: "Confirm merge #5" }));
    await waitFor(() =>
      expect(api.mergePullRequest).toHaveBeenCalledWith({
        host: "github.com",
        repository: "acme/web",
        number: 5,
        method: "squash",
        expectedHeadOid: "head-5",
      }),
    );

    const close = within(group).getByRole("button", { name: "Close #5" });
    await userEvent.click(close);
    expect(api.setPullRequestState).not.toHaveBeenCalled();
    await userEvent.click(within(group).getByRole("button", { name: "Confirm close #5" }));
    await waitFor(() =>
      expect(api.setPullRequestState).toHaveBeenCalledWith({
        host: "github.com",
        repository: "acme/web",
        number: 5,
        state: "closed",
      }),
    );

    act(() => void fireEvent.keyUp(window, { key: "Shift" }));
    expect(group.hasAttribute("data-visible")).toBe(false);
  });

  it("asks the user to sign in to GitHub without searching", async () => {
    const { api } = installSourceControl({
      status: async () => sourceControlStatus({ github: { authenticated: false } }),
    });
    renderPullRequestsPage();
    expect(await screen.findByText("Sign in to GitHub")).toBeTruthy();
    expect(screen.getByText("gh auth login")).toBeTruthy();
    expect(api.searchPullRequests).not.toHaveBeenCalled();
  });

  it("explains a rate limit with its retry time, per list and for background sync", async () => {
    const retryAt = new Date(2026, 9, 11, 14, 30).getTime();
    const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
      retryAt,
    );
    installSourceControl({
      status: async () => sourceControlStatus({ github: { pausedUntil: Date.now() + 60_000 } }),
      searchPullRequests: async () => ({
        ok: false,
        error: { code: "github-rate-limited", message: "Slow down", retryAt },
      }),
    });
    renderPullRequestsPage();
    expect((await screen.findByRole("status")).textContent).toContain("GitHub rate limit reached");
    await waitFor(() =>
      expect(
        screen.getAllByText(`GitHub rate limit reached. Try again after ${time}.`),
      ).toHaveLength(5),
    );
  });

  it("keeps lists but explains that task linking is unavailable on remote connections", async () => {
    installSourceControl({
      status: async () =>
        sourceControlStatus({ supported: false, unsupportedReason: "This is an SSH connection." }),
      searchPullRequests: searchPages({ "review-requested": { "": { items: [pullRequest(5)] } } }),
    });
    renderPullRequestsPage({ pr: "github.com/acme/web/5", selectedSessionID: task.id });
    expect(
      await screen.findByText(/Task linking is unavailable on this connection\. This is an SSH/),
    ).toBeTruthy();
    expect(await screen.findByRole("button", { name: /^#5 / })).toBeTruthy();
    await screen.findByRole("region", { name: /^#5 / });
    expect(screen.queryByRole("button", { name: /Link to current task/ })).toBeNull();
  });

  it("starts a task in the matching project with a prompt referencing the pull request", async () => {
    installSourceControl();
    const { router, store } = renderPullRequestsPage({ pr: "github.com/acme/web/8" });
    await userEvent.click(await screen.findByRole("button", { name: "Start task" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/new"));
    const draft = store.get(
      composerDraftAtomFamily(composerScope("profile", `new:${project.id}:${project.canonical}:`)),
    );
    expect(draft.text).toBe("Work on this pull request: https://github.com/acme/web/pull/8");
  });

  it("links the selected pull request to the current task and opens linked tasks", async () => {
    const { api } = installSourceControl({
      listPullRequestLinks: async () => ({ ok: true, value: [pullRequestLink("other-task", 5)] }),
    });
    const { router } = renderPullRequestsPage({
      pr: "github.com/acme/web/5",
      selectedSessionID: task.id,
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Link to current task, Fix login" }),
    );
    await waitFor(() =>
      expect(api.linkPullRequest).toHaveBeenCalledWith({
        profileID: "profile",
        sessionID: task.id,
        url: "https://github.com/acme/web/pull/5",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Open task Untitled task" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sessions/other-task"));
  });
});
