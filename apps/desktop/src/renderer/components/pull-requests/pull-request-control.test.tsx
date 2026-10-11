import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../../shared";
import { runtimeAtom } from "../../atoms/workspace";
import { createRendererQueryClient } from "../../lib/query-client";
import { renderWithRouter } from "../../test-utils/render-with-router";
import { PullRequestControl } from "./pull-request-control";
import { installSourceControl, pullRequestLink, sourceControlStatus } from "./test-fixtures";
import { useArmedConfirm } from "./use-armed-confirm";

const session: PalotSession = {
  id: "task-1",
  parentID: null,
  projectID: "project-1",
  title: "Fix login",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "palot");
});

function renderControl() {
  const store = createStore();
  store.set(runtimeAtom, {
    profileID: "profile",
    connectionID: "c1",
    connected: true,
  } as OpenCodeRuntimeStatus);
  return render(
    <Provider store={store}>
      <QueryClientProvider client={createRendererQueryClient()}>
        <PullRequestControl session={session} />
      </QueryClientProvider>
    </Provider>,
  );
}

describe("PullRequestControl", () => {
  it("links by branch detection or by a pasted URL when nothing is linked", async () => {
    const { api } = installSourceControl();
    renderControl();
    await userEvent.click(await screen.findByRole("button", { name: "Pull request" }));
    await userEvent.click(await screen.findByRole("button", { name: "Detect from branch" }));
    await waitFor(() =>
      expect(api.linkPullRequest).toHaveBeenCalledWith({
        profileID: "profile",
        sessionID: "task-1",
      }),
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: "Pull request URL" }),
      "https://github.com/acme/web/pull/9",
    );
    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() =>
      expect(api.linkPullRequest).toHaveBeenLastCalledWith({
        profileID: "profile",
        sessionID: "task-1",
        url: "https://github.com/acme/web/pull/9",
      }),
    );
  });

  it("explains a failed branch detection in place", async () => {
    installSourceControl({
      linkPullRequest: vi.fn(async () => ({
        ok: false as const,
        error: { code: "no-pull-request" as const, message: "none" },
      })),
    });
    renderControl();
    await userEvent.click(await screen.findByRole("button", { name: "Pull request" }));
    await userEvent.click(await screen.findByRole("button", { name: "Detect from branch" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "No pull request was found for this task's branch.",
    );
  });

  it("toggles watching and unlinks only after an in-place confirmation", async () => {
    const link = pullRequestLink("task-1", 12, {
      watchEnded: { reason: "comment-limit", at: 1 },
      syncError: "GitHub timed out",
      pullRequest: { checks: "failing" },
    });
    const { api } = installSourceControl({
      listPullRequestLinks: vi.fn(async () => ({ ok: true as const, value: [link] })),
    });
    renderControl();
    await userEvent.click(
      await screen.findByRole("button", { name: "Pull request #12, open, checks failing" }),
    );
    expect(screen.getByText(/Wakes the agent when checks fail or pass/)).toBeTruthy();
    expect(screen.getByText("Stopped watching after 10 comment-only wake-ups")).toBeTruthy();
    expect(screen.getByText("Last refresh failed: GitHub timed out")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Watch" }));
    await waitFor(() =>
      expect(api.watchPullRequest).toHaveBeenCalledWith({
        profileID: "profile",
        sessionID: "task-1",
        key: link.key,
        watching: true,
      }),
    );

    const unlink = screen.getByRole("button", { name: "Unlink" });
    await userEvent.click(unlink);
    expect(api.unlinkPullRequest).not.toHaveBeenCalled();
    expect(unlink.textContent).toBe("Confirm unlink");
    fireEvent.keyDown(unlink, { key: "Escape" });
    expect(unlink.textContent).toBe("Unlink");

    await userEvent.click(unlink);
    await userEvent.click(unlink);
    await waitFor(() =>
      expect(api.unlinkPullRequest).toHaveBeenCalledWith({
        profileID: "profile",
        sessionID: "task-1",
        key: link.key,
      }),
    );
  });

  it("links and refreshes when only the GH_HOST instance is signed in", async () => {
    const link = pullRequestLink("task-1", 4, {
      key: "ghe.example.com/acme/web#4",
      pullRequest: { host: "ghe.example.com", url: "https://ghe.example.com/acme/web/pull/4" },
    });
    const signedOut = sourceControlStatus().github;
    const { api } = installSourceControl({
      status: vi.fn(async () =>
        sourceControlStatus({
          github: { authenticated: false, source: null, login: null },
          githubHosts: [
            { ...signedOut, authenticated: false, source: null, login: null },
            { ...signedOut, host: "ghe.example.com", login: "enterprise-user" },
          ],
        }),
      ),
      listPullRequestLinks: vi.fn(async () => ({ ok: true as const, value: [link] })),
    });
    renderControl();
    await userEvent.click(await screen.findByRole("button", { name: /Pull request #4/ }));
    const refresh = await screen.findByRole("button", { name: "Refresh pull requests" });
    await waitFor(() => expect(refresh.hasAttribute("disabled")).toBe(false));
    expect(screen.queryByText(/GitHub is not signed in/)).toBeNull();
    await userEvent.click(refresh);
    await waitFor(() =>
      expect(api.refreshPullRequests).toHaveBeenCalledWith({
        profileID: "profile",
        sessionID: "task-1",
      }),
    );
  });

  it("asks to sign in when no GitHub host is signed in", async () => {
    const signedOut = { authenticated: false, source: null, login: null } as const;
    installSourceControl({
      status: vi.fn(async () =>
        sourceControlStatus({
          github: signedOut,
          githubHosts: [{ ...sourceControlStatus().github, ...signedOut }],
        }),
      ),
    });
    renderControl();
    await userEvent.click(await screen.findByRole("button", { name: "Pull request" }));
    expect(await screen.findByText(/GitHub is not signed in/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Detect from branch" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("opens the linked pull request in the review screen", async () => {
    installSourceControl({
      listPullRequestLinks: async () => ({ ok: true, value: [pullRequestLink("task-1", 12)] }),
    });
    const store = createStore();
    store.set(runtimeAtom, {
      profileID: "profile",
      connectionID: "c1",
      connected: true,
    } as OpenCodeRuntimeStatus);
    const { router } = renderWithRouter(<PullRequestControl session={session} />, store);
    await userEvent.click(await screen.findByRole("button", { name: /^Pull request #12/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Open in Pull requests" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/pull-requests"));
    expect(router.state.location.search).toMatchObject({ pr: "github.com/acme/web/12" });
  });

  it("disables the control with a reason on unsupported connections", async () => {
    installSourceControl({
      status: vi.fn(async () =>
        sourceControlStatus({ supported: false, unsupportedReason: "Remote connection." }),
      ),
      listPullRequestLinks: vi.fn(async () => ({
        ok: false as const,
        error: { code: "unsupported-connection" as const, message: "Remote" },
      })),
    });
    renderControl();
    expect(
      await screen.findByRole("button", { name: "Pull request unavailable: Remote connection." }),
    ).toBeTruthy();
  });
});

describe("useArmedConfirm", () => {
  it("disarms after three seconds or on blur", () => {
    vi.useFakeTimers();
    const confirm = vi.fn();
    const { result } = renderHook(() => useArmedConfirm(confirm));
    act(() => result.current.buttonProps.onClick());
    expect(result.current.armed).toBe(true);
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current.armed).toBe(false);

    act(() => result.current.buttonProps.onClick());
    act(() => result.current.buttonProps.onBlur({} as never));
    expect(result.current.armed).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});
