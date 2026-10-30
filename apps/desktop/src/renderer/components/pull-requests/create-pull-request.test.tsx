import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createRendererQueryClient } from "../../lib/query-client";
import { CreatePullRequestControl } from "./create-pull-request";
import { installSourceControl, pullRequestLink } from "./test-fixtures";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../../services/opencode-generate", () => ({ generateOpenCodeText: mocks.generate }));
vi.mock("../../services/opencode-client", () => ({
  openCodeClient: () => ({
    session: { get: async () => ({ title: "Task context" }) },
    message: { list: async () => ({ data: [{ type: "user", text: "Requested feature" }] }) },
  }),
}));

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "palot");
  vi.clearAllMocks();
});

it("keeps edits made during generation and creates/links only after review", async () => {
  let resolve!: (text: string) => void;
  mocks.generate.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  const { api } = installSourceControl({
    preparePullRequest: async () => ({
      ok: true,
      value: {
        branch: "feature",
        base: "main",
        branches: ["main"],
        diff: "committed diff",
        commits: "Add feature",
        pushed: true,
        existing: null,
      },
    }),
    createPullRequest: async () => ({ ok: true, value: pullRequestLink("task", 7) }),
  });
  render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <CreatePullRequestControl
        profileID="profile"
        sessionID="task"
        model={null}
        pushing={false}
        push={vi.fn()}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create pull request" }));
  const dialog = await screen.findByRole("dialog", { name: "Create pull request" });
  await waitFor(() => expect(mocks.generate).toHaveBeenCalled());
  expect(mocks.generate.mock.calls[0]![0].prompt).toContain("Requested feature");
  expect(mocks.generate.mock.calls[0]![0].prompt).toContain("committed diff");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Pull request title" }), {
    target: { value: "My edited title" },
  });
  resolve(JSON.stringify({ title: "Generated title", body: "Generated body" }));
  await waitFor(() =>
    expect(
      (
        within(dialog).getByRole("textbox", {
          name: "Pull request description",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Generated body"),
  );
  expect(
    (within(dialog).getByRole("textbox", { name: "Pull request title" }) as HTMLInputElement).value,
  ).toBe("My edited title");
  expect(api.createPullRequest).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Draft pull request" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Create pull request" }));
  await waitFor(() =>
    expect(api.createPullRequest).toHaveBeenCalledWith({
      profileID: "profile",
      sessionID: "task",
      base: "main",
      title: "My edited title",
      body: "Generated body",
      draft: true,
    }),
  );
  expect(await screen.findByRole("button", { name: "Watch pull request" })).not.toBeNull();
});
