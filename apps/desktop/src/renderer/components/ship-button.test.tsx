import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import type { GitWorkingTreeStatus } from "../../shared/source-control-contract";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { palot } from "../services/palot";
import { installSourceControl } from "./pull-requests/test-fixtures";
import { ShipButton } from "./ship-button";

vi.mock("../services/opencode-generate", () => ({
  generateOpenCodeText: vi.fn(async () => "feat: add billing"),
}));
vi.mock("../services/opencode-vcs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/opencode-vcs")>()),
  getOpenCodeVcsInfo: vi.fn(async () => ({ currentBranch: "feature", defaultBranch: "main" })),
}));

const session: PalotSession = {
  id: "task-1",
  parentID: null,
  projectID: "project-1",
  title: "Add billing",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

function tree(
  overrides: Partial<GitWorkingTreeStatus["branch"]> = {},
  dirty = true,
): GitWorkingTreeStatus {
  return {
    root: "/repo",
    branch: {
      name: "feature",
      oid: "abc1234",
      upstream: "origin/feature",
      ahead: 0,
      behind: 0,
      ...overrides,
    },
    truncated: false,
    files: dirty
      ? [
          {
            path: "billing.ts",
            originalPath: null,
            index: ".",
            worktree: "M",
            staged: false,
            unstaged: true,
            untracked: false,
            conflicted: false,
          },
        ]
      : [],
  };
}

function renderButton() {
  const store = createStore();
  store.set(runtimeAtom, {
    profileID: "profile",
    connectionID: "c1",
    connected: true,
  } as OpenCodeRuntimeStatus);
  return render(
    <Provider store={store}>
      <QueryClientProvider client={createRendererQueryClient()}>
        <ShipButton session={session} />
      </QueryClientProvider>
    </Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "palot");
});

describe("ShipButton", () => {
  it("confirms the generated message, then names each stage and the failed push without losing the commit", async () => {
    vi.spyOn(palot, "listDiffs").mockResolvedValue([]);
    const { api } = installSourceControl({
      gitStatus: async () => ({ ok: true, value: tree() }),
      gitStage: async () => ({ ok: true, value: tree() }),
      gitCommit: async () => ({
        ok: true,
        value: { oid: "def5678abc", summary: "feat: add billing", branch: tree().branch },
      }),
      gitPush: async () => ({
        ok: false,
        error: { code: "push-rejected", message: "Updates were rejected" },
      }),
    });
    renderButton();
    await userEvent.click(await screen.findByRole("button", { name: "Commit & push" }));
    const form = await screen.findByRole("form", { name: "Commit & push" });
    const message = within(form).getByRole("textbox", { name: "Commit message" });
    await waitFor(() => expect((message as HTMLTextAreaElement).value).toBe("feat: add billing"));
    expect(form.textContent).toContain("Stages and commits the changed file");
    expect(api.gitCommit).not.toHaveBeenCalled();
    expect(api.gitPush).not.toHaveBeenCalled();

    await userEvent.type(message, "{Enter}");
    const stages = await screen.findByRole("list", { name: "Stages" });
    await waitFor(() =>
      expect(within(stages).getByRole("alert").textContent).toBe(
        "Push failed: origin has commits this branch doesn't. Pull them first, then push again.",
      ),
    );
    expect(stages.textContent).toContain("Committed def5678 feat: add billing");
    expect(screen.getByText("The commit is kept.")).toBeTruthy();
    expect(api.gitStage).toHaveBeenCalledWith({
      profileID: "profile",
      directory: "/repo",
      paths: ["billing.ts"],
    });
    expect(api.gitCommit).toHaveBeenCalledWith({
      profileID: "profile",
      directory: "/repo",
      message: "feat: add billing",
    });
  });

  it("refuses with the reason when the branch is behind", async () => {
    installSourceControl({ gitStatus: async () => ({ ok: true, value: tree({ behind: 3 }) }) });
    renderButton();
    const button = await screen.findByRole("button", {
      name: "Can't ship: Branch is behind origin. Pull first.",
    });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.textContent).toBe("Behind origin");
  });

  it("asks for a feature branch named after the task on the default branch", async () => {
    vi.spyOn(palot, "listDiffs").mockResolvedValue([]);
    const { api } = installSourceControl({
      gitStatus: async () => ({ ok: true, value: tree({ name: "main", upstream: "origin/main" }) }),
      gitBranch: async () => ({ ok: true, value: tree() }),
      gitStage: async () => ({ ok: true, value: tree() }),
      gitCommit: async () => ({
        ok: true,
        value: { oid: "def5678abc", summary: "feat: add billing", branch: tree().branch },
      }),
    });
    renderButton();
    await userEvent.click(await screen.findByRole("button", { name: "Commit" }));
    const name = await screen.findByRole("textbox", { name: "New branch name" });
    expect((name as HTMLInputElement).value).toBe("palot/add-billing");
    await userEvent.clear(name);
    await userEvent.type(name, "palot/billing");
    const message = screen.getByRole("textbox", { name: "Commit message" });
    await waitFor(() => expect((message as HTMLTextAreaElement).value).toBe("feat: add billing"));
    await userEvent.type(message, "{Enter}");
    const stages = await screen.findByRole("list", { name: "Stages" });
    await waitFor(() => expect(stages.textContent).toContain("Committed def5678"));
    expect(stages.textContent).toContain("Created branch palot/billing");
    expect(api.gitBranch).toHaveBeenCalledWith({
      profileID: "profile",
      directory: "/repo",
      action: "create",
      name: "palot/billing",
      carryChanges: true,
    });
    expect(api.gitPush).not.toHaveBeenCalled();
  });
});
