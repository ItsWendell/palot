import type { FileDiffInfo } from "@opencode/client";
import type { CodeViewItem } from "@pierre/diffs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  GitBranchStatus,
  GitFileStatus,
  GitWorkingTreeStatus,
} from "../../../shared/source-control-contract";
import { SourceControlError } from "../../hooks/use-source-control";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { ChangesTab } from "./changes-tab";

const mocks = vi.hoisted(() => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    diffs: [] as FileDiffInfo[],
    supported: true,
    tree: null as GitWorkingTreeStatus | null,
    stage: mutation(),
    unstage: mutation(),
    commit: mutation(),
    push: mutation(),
    generate: vi.fn(),
  };
});
vi.mock("../../atoms/workbench", () => ({ useWorkbenchCommands: () => ({ openTab: vi.fn() }) }));
vi.mock("../../hooks/use-location-diffs", () => ({
  useLocationDiffs: () => ({
    isPending: false,
    isSuccess: true,
    isError: false,
    isFetching: false,
    data: mocks.diffs,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
    reviewBase: { ref: "main", manual: null, inferred: { data: null } },
  }),
}));
vi.mock("../../hooks/use-vcs-info", () => ({ useVcsInfo: () => ({ data: null }) }));
vi.mock("../../hooks/use-vcs-repository", () => ({
  useVcsProvider: () => ({ isSuccess: true, data: "git" }),
  useInitializeGit: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../hooks/use-source-control", async (original) => ({
  ...(await original<typeof import("../../hooks/use-source-control")>()),
  useSourceControlStatus: () => ({
    data: {
      supported: mocks.supported,
      unsupportedReason: mocks.supported ? null : "Remote connection",
    },
  }),
  useGitStatus: () => ({ data: mocks.tree ?? undefined, error: null, refetch: vi.fn() }),
  useGitStage: () => mocks.stage,
  useGitUnstage: () => mocks.unstage,
  useGitCommit: () => mocks.commit,
  useGitPush: () => mocks.push,
}));
vi.mock("../../hooks/use-session-catalog", () => ({
  useSessionCatalogSelector: (select: (sessions: unknown[]) => unknown) =>
    select([{ id: "session", model: { id: "fast", providerID: "acme" } }]),
}));
vi.mock("../../services/opencode-generate", () => ({ generateOpenCodeText: mocks.generate }));
vi.mock("../review-comment-editor", () => ({
  useReviewComments: () => ({}),
  ReviewCommentEditor: () => null,
}));
vi.mock("@pierre/trees/react", () => ({
  FileTree: () => null,
  useFileTree: () => ({ model: { resetPaths: vi.fn(), setGitStatus: vi.fn() } }),
}));
vi.mock("@pierre/diffs/react", () => ({
  CodeView: ({
    items,
    renderCustomHeader,
  }: {
    items: CodeViewItem<undefined>[];
    renderCustomHeader(item: CodeViewItem<undefined>): ReactNode;
  }) => (
    <div>
      {items.map((item) => (
        <div key={item.id}>{renderCustomHeader(item)}</div>
      ))}
    </div>
  ),
}));

function file(path: string, change: Partial<GitFileStatus>): GitFileStatus {
  return {
    path,
    originalPath: null,
    index: ".",
    worktree: ".",
    staged: false,
    unstaged: false,
    untracked: false,
    conflicted: false,
    ...change,
  };
}

function diff(path: string): FileDiffInfo {
  return {
    file: path,
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: [`--- a/${path}`, `+++ b/${path}`, "@@ -1 +1 @@", `-old ${path}`, `+new ${path}`].join(
      "\n",
    ),
  };
}

const branch = (change: Partial<GitBranchStatus> = {}): GitBranchStatus => ({
  name: "feature",
  oid: "1111111aaaa",
  upstream: "origin/feature",
  ahead: 0,
  behind: 0,
  ...change,
});

beforeEach(() => {
  mocks.supported = true;
  mocks.diffs = [diff("app.ts"), diff("lib/util.ts"), diff("new.txt")];
  mocks.tree = {
    root: "/repo",
    truncated: false,
    branch: branch(),
    files: [
      file("app.ts", { worktree: "M", unstaged: true }),
      file("lib/util.ts", { index: "M", staged: true }),
      file("new.txt", { untracked: true }),
    ],
  };
  for (const mutation of [mocks.stage, mocks.unstage, mocks.commit, mocks.push])
    mutation.mutate.mockReset();
  mocks.generate.mockReset();
});
afterEach(cleanup);

const tab = {
  id: "changes",
  kind: "changes",
  pinned: false,
  resource: {
    profileID: "profile",
    location: { directory: "/repo" },
    mode: "working",
    sourceSessionID: "session",
  },
} as Extract<WorkbenchTab, { kind: "changes" }>;

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChangesTab tab={tab} pane="right" scope={{ profileID: "profile", sessionID: "session" }} />
    </QueryClientProvider>,
  );
}

const target = { profileID: "profile", directory: "/repo" };

it("stages and unstages files by repository path, one at a time or all together", () => {
  renderTab();
  const staged = screen.getByRole("checkbox", { name: "Unstage lib/util.ts" });
  expect(staged.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("checkbox", { name: "Stage app.ts" }).getAttribute("aria-checked")).toBe(
    "false",
  );
  expect(screen.getByText("1 of 3 staged")).toBeTruthy();

  fireEvent.click(screen.getByRole("checkbox", { name: "Stage app.ts" }));
  expect(mocks.stage.mutate).toHaveBeenCalledWith(
    { ...target, paths: ["app.ts"] },
    expect.anything(),
  );
  fireEvent.click(staged);
  expect(mocks.unstage.mutate).toHaveBeenCalledWith(
    { ...target, paths: ["lib/util.ts"] },
    expect.anything(),
  );

  fireEvent.click(screen.getByRole("button", { name: "Stage all" }));
  expect(mocks.stage.mutate).toHaveBeenLastCalledWith(
    { ...target, paths: ["app.ts", "new.txt"] },
    expect.anything(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Unstage all" }));
  expect(mocks.unstage.mutate).toHaveBeenLastCalledWith(
    { ...target, paths: ["lib/util.ts"] },
    expect.anything(),
  );
});

it("commits staged changes with Mod+Enter only when a message and staged files exist", () => {
  mocks.commit.mutate.mockImplementation((_input, options) =>
    options.onSuccess({ oid: "abc1234def567", summary: "fix: tidy util", branch: branch() }),
  );
  mocks.tree!.branch = branch({ upstream: null });
  renderTab();
  const commit = screen.getByRole("button", { name: "Commit" });
  const message = screen.getByRole("textbox", { name: "Commit message" });
  expect(commit.hasAttribute("disabled")).toBe(true);

  fireEvent.change(message, { target: { value: "  fix: tidy util  " } });
  expect(commit.hasAttribute("disabled")).toBe(false);
  fireEvent.keyDown(message, { key: "Enter" });
  expect(mocks.commit.mutate).not.toHaveBeenCalled();
  fireEvent.keyDown(message, { key: "Enter", ctrlKey: true });
  expect(mocks.commit.mutate).toHaveBeenCalledWith(
    { ...target, message: "fix: tidy util" },
    expect.anything(),
  );

  // Success confirms with the short oid, clears the draft, and offers to publish.
  expect(screen.getByText("abc1234")).toBeTruthy();
  expect((message as HTMLTextAreaElement).value).toBe("");
  const status = screen.getByText("abc1234").closest("[role=status]")!;
  fireEvent.click(status.querySelector("button")!);
  expect(status.textContent).toContain("Publish branch");
  expect(mocks.push.mutate).toHaveBeenCalledWith(target, expect.anything());
});

it("keeps Commit disabled while nothing is staged", () => {
  mocks.tree!.files = mocks.tree!.files.map((entry) => ({ ...entry, staged: false }));
  renderTab();
  fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
    target: { value: "feat: something" },
  });
  expect(screen.getByRole("button", { name: "Commit" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Generate message" }).hasAttribute("disabled")).toBe(
    true,
  );
});

it("drafts the message from the staged diff with the task's model", async () => {
  mocks.generate.mockResolvedValue("```\nfix(util): handle empty input\n```");
  renderTab();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Generate message" }));
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("textbox", { name: "Commit message" }) as HTMLTextAreaElement).value,
    ).toBe("fix(util): handle empty input"),
  );
  const [{ prompt, model }] = mocks.generate.mock.calls[0]!;
  expect(model).toEqual({ id: "fast", providerID: "acme" });
  expect(prompt).toContain("new lib/util.ts");
  expect(prompt).not.toContain("new app.ts");
});

it("labels Push by upstream and hides it when the branch is up to date", () => {
  mocks.tree!.branch = branch({ upstream: null });
  const { unmount } = renderTab();
  expect(screen.getByRole("button", { name: "Publish branch" })).toBeTruthy();
  unmount();

  mocks.tree!.branch = branch({ ahead: 2, behind: 1 });
  const second = renderTab();
  fireEvent.click(screen.getByRole("button", { name: "Push" }));
  expect(mocks.push.mutate).toHaveBeenCalledWith(target, expect.anything());
  expect(screen.getByLabelText("2 ahead, 1 behind origin/feature")).toBeTruthy();
  second.unmount();

  mocks.tree!.branch = branch();
  renderTab();
  expect(screen.queryByRole("button", { name: /^(Push|Publish branch)$/ })).toBeNull();
});

it("explains failures inline, including hook output", async () => {
  mocks.commit.mutate.mockImplementation((_input, options) =>
    options.onError(
      new SourceControlError({
        code: "hook-failed",
        message: "pre-commit hook failed",
        detail: "eslint: 2 problems",
      }),
    ),
  );
  mocks.tree!.branch = branch({ ahead: 1 });
  mocks.push.mutate.mockImplementation((_input, options) =>
    options.onError(new SourceControlError({ code: "push-rejected", message: "rejected" })),
  );
  renderTab();
  fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
    target: { value: "fix: x" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Commit" }));
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("Could not commit: a Git hook rejected it.");
  fireEvent.click(screen.getByRole("button", { name: "Hook output" }));
  await waitFor(() => expect(screen.getByText("eslint: 2 problems")).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: "Push" }));
  expect(screen.getByRole("alert").textContent).toContain("Pull them first, then push again.");

  mocks.commit.mutate.mockImplementation((_input, options) =>
    options.onError(new SourceControlError({ code: "identity-missing", message: "no identity" })),
  );
  fireEvent.click(screen.getByRole("button", { name: "Commit" }));
  expect(screen.getByRole("alert").textContent).toContain("user.name and user.email");
});

it("shows only a note for remote connections", () => {
  mocks.supported = false;
  renderTab();
  expect(screen.getByText("Commit and push are available for local connections.")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Commit message" })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
});
