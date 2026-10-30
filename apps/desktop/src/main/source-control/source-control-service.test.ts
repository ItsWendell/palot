// @vitest-environment node
import { expect, it, vi } from "vitest";
import { SourceControlService } from "./source-control-service";
import { GitCommandError } from "./git";

it("sync pulls before pushing and never pushes when pulling fails", async () => {
  const events = vi.fn();
  const pull = vi.fn(async () => ({}));
  const push = vi.fn(async () => ({}));
  const service = new SourceControlService({
    git: { pull, push },
    isLocalProfile: () => true,
    emit: events,
  } as never);
  const input = {
    profileID: "local",
    directory: "/repo",
    strategy: "rebase" as const,
    confirmDefaultBranch: true,
  };
  expect((await service.gitSync(input)).ok).toBe(true);
  expect(pull).toHaveBeenCalledWith("/repo", "rebase");
  expect(push).toHaveBeenCalledWith("/repo", true);
  expect(pull.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]!);
  push.mockClear();
  pull.mockRejectedValue(new GitCommandError("branch-diverged", "Choose merge or rebase"));
  expect(await service.gitSync(input)).toMatchObject({
    ok: false,
    error: { code: "branch-diverged" },
  });
  expect(push).not.toHaveBeenCalled();
  expect(events).toHaveBeenLastCalledWith({ type: "git", profileID: "local", directory: "/repo" });
});
