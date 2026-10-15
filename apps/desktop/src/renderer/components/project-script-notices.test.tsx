import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectScriptRun } from "../../shared/project-scripts-contract";
import { createRendererQueryClient } from "../lib/query-client";
import { ProjectScriptNotices } from "./project-script-notices";
import { toast } from "./ui/toast";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "palot");
});

const run: ProjectScriptRun = {
  id: "run-1",
  trigger: "settle",
  profileID: "local",
  projectID: "project-1",
  sessionID: "session-1",
  scriptID: "script-1",
  scriptName: "test",
  command: "bun test",
  directory: "/repo",
  startedAt: 1_000,
  finishedAt: 3_500,
  status: "failed",
  exitCode: 2,
  signal: null,
  output: "1 failing\n",
  outputTruncated: false,
  error: null,
};

describe("ProjectScriptNotices", () => {
  it("reports a finished run quietly and shows its output on request", async () => {
    let emit!: (run: ProjectScriptRun) => void;
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: {
        projectScripts: {
          onRunFinished: (listener: (run: ProjectScriptRun) => void) => {
            emit = listener;
            return () => undefined;
          },
        },
      },
    });
    const add = vi.spyOn(toast, "add");
    render(
      <QueryClientProvider client={createRendererQueryClient()}>
        <Provider store={createStore()}>
          <ProjectScriptNotices />
        </Provider>
      </QueryClientProvider>,
    );
    act(() => emit(run));
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "warning",
        title: "Ran “test” after settling: failed",
        actionProps: expect.objectContaining({ children: "View output" }),
      }),
    );
    act(() => (add.mock.calls[0]![0].actionProps!.onClick as () => void)());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Exit code 2 · 2.5s")).toBeTruthy();
    expect(within(dialog).getByLabelText("Script output").textContent).toBe("1 failing\n");
    expect(within(dialog).getByRole("group", { name: "Command" }).textContent).toContain(
      "bun test",
    );
  });
});
