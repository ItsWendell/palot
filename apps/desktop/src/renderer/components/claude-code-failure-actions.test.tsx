import { createStore } from "jotai";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import * as clipboard from "../lib/clipboard";
import { projectTranscriptTurns } from "../lib/turn-projection";
import { renderWithRouter } from "../test-utils/render-with-router";
import { ClaudeCodeFailureActions } from "./claude-code-failure-actions";
import { TimelineBoundary } from "./transcript/timeline-parts";

function failure(message: string): PalotMessage {
  return {
    id: "failure",
    type: "assistant",
    createdAt: 1,
    completedAt: 2,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: "error",
    content: [],
    data: { error: { type: "provider.error", message } },
  };
}

function boundary(message: PalotMessage) {
  return projectTranscriptTurns([message])[0]!.activity.find((item) => item.kind === "boundary")!;
}

function store() {
  const value = createStore();
  value.set(runtimeAtom, {
    connectionID: "one",
    profileID: "profile-one",
    contractVersion: "test",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: "2.2.5",
    pid: 1,
    managed: true,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  return value;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ClaudeCodeFailureActions", () => {
  it("opens Claude Agent setup from a reply that failed sign-in", async () => {
    const { router } = renderWithRouter(
      <TimelineBoundary
        group={boundary(failure("Install Claude Code and run `claude auth login` first"))}
      />,
      store(),
    );
    expect(screen.getByRole("alert").textContent).toContain("claude auth login");
    await userEvent.click(screen.getByRole("button", { name: "Open Claude Agent setup" }));
    await waitFor(() => expect(router.history.location.pathname).toBe("/settings/providers"));
    expect(router.state.location.search).toMatchObject({
      profileID: "profile-one",
      connect: "claude-agent",
    });
  });

  it("copies the command OpenCode's error names", async () => {
    const write = vi.spyOn(clipboard, "writeClipboardText").mockResolvedValue(undefined);
    render(
      <ClaudeCodeFailureActions detail="Claude Code 2.1.100 is too old; 2.1.248 or later is required. Run `claude update`." />,
    );
    // Without a router there is no setup link, but the command still copies.
    expect(screen.queryByRole("button", { name: "Open Claude Agent setup" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Copy update command" }));
    expect(write).toHaveBeenCalledWith("claude update");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("stays out of unrelated failures", () => {
    render(<ClaudeCodeFailureActions detail="Anthropic is overloaded (529)." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
