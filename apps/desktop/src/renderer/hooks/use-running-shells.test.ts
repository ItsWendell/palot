import { describe, expect, it } from "vitest";
import type { PalotRunningShell } from "../../shared";
import { openCodeKeys } from "../lib/opencode-query";
import { reuseRunningShells, runningShellsQueryOptions } from "./use-running-shells";

describe("running shell query", () => {
  it("keys shell state by connection and stable location fields", () => {
    const location = { directory: "/repo", workspaceID: "workspace" };

    expect(runningShellsQueryOptions("connection", location, true).queryKey).toEqual(
      openCodeKeys.runningShells("connection", location),
    );
  });

  it("uses events and reconnect recovery instead of polling", () => {
    expect(
      runningShellsQueryOptions("connection", { directory: "/repo" }, true).refetchInterval,
    ).toBe(false);
  });

  it("reuses an unchanged shell list", () => {
    const previous: PalotRunningShell[] = [
      {
        id: "shell",
        sessionID: "session",
        command: "sleep 30",
        cwd: "/repo",
        startedAt: 1,
        status: "running",
      },
    ];

    expect(reuseRunningShells(previous, [{ ...previous[0]! }])).toBe(previous);
    expect(reuseRunningShells(previous, [{ ...previous[0]!, id: "other" }])).not.toBe(previous);
    expect(reuseRunningShells(previous, [{ ...previous[0]!, command: "sleep 60" }])).not.toBe(
      previous,
    );
    expect(reuseRunningShells(previous, [{ ...previous[0]!, status: "exited", exit: 0 }])).not.toBe(
      previous,
    );
  });
});
