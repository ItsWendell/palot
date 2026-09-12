import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotSession } from "../../shared";
import { ProcessFooterControl, processCountLabel, processStatus } from "./process-footer-control";
import type { SessionCommand, SessionTerminal } from "../hooks/use-session-processes";

const mocks = vi.hoisted(() => ({ openTab: vi.fn(() => ({ ok: true })), processes: vi.fn() }));
vi.mock("../hooks/use-session-processes", () => ({ useSessionProcesses: () => mocks.processes() }));
vi.mock("../atoms/workbench", () => ({ useWorkbenchCommands: () => ({ openTab: mocks.openTab }) }));

describe("process footer", () => {
  afterEach(cleanup);
  it("hides an empty or loading picker", () => {
    mocks.processes.mockReturnValue({ rows: [], commands: 0, terminals: 0, loading: true });
    render(
      <ProcessFooterControl
        session={{ id: "empty" } as PalotSession}
        sessionIDs={new Set(["empty"])}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps recent commands accessible under Recently finished", async () => {
    mocks.processes.mockReturnValue({
      rows: [
        {
          kind: "command",
          id: "finished",
          sessionID: "root",
          command: "echo done",
          cwd: "/repo",
          startedAt: 1,
          active: false,
          status: "exited",
          exit: 0,
        },
      ],
      commands: 0,
      terminals: 0,
      owners: new Map(),
      terminalsSupported: true,
    });
    render(
      <ProcessFooterControl
        session={{ id: "root" } as PalotSession}
        sessionIDs={new Set(["root"])}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Commands & terminals: Recently finished" }),
    );
    expect(await screen.findByRole("region", { name: "Recently finished" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Running commands" })).toBeNull();
    expect(screen.getByRole("button", { name: /echo done/ })).toBeTruthy();
  });

  it("keeps errors discoverable with an explicit retry", async () => {
    const retry = vi.fn();
    mocks.processes.mockReturnValue({
      rows: [],
      commands: 0,
      terminals: 0,
      owners: new Map(),
      terminalsSupported: true,
      error: "Terminals could not be refreshed.",
      retry,
    });
    render(
      <ProcessFooterControl
        session={{ id: "error" } as PalotSession}
        sessionIDs={new Set(["error"])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Commands & terminals" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Terminals could not be refreshed.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("labels command, terminal, and mixed counts", () => {
    expect(processCountLabel(1, 0)).toBe("1 command");
    expect(processCountLabel(0, 2)).toBe("2 terminals");
    expect(processCountLabel(1, 1)).toBe("2 processes");
  });

  it("does not infer terminal busyness or command success from missing process metadata", () => {
    expect(
      processStatus({
        kind: "terminal",
        active: true,
        status: "running",
        foregroundProcess: null,
      } as SessionTerminal),
    ).toBe("Terminal open");
    expect(
      processStatus({
        kind: "terminal",
        active: true,
        status: "running",
        foregroundProcess: "vim",
      } as SessionTerminal),
    ).toBe("Foreground: vim");
    expect(
      processStatus({ kind: "command", active: false, status: "running" } as SessionCommand),
    ).toContain("final status unavailable");
    expect(
      processStatus({
        kind: "command",
        active: false,
        status: "exited",
        exit: 1,
      } as SessionCommand),
    ).toBe("Exited · code 1");
  });

  it("opens a command in the workbench with native identity and restores trigger focus", async () => {
    const location = { directory: "/repo" };
    mocks.processes.mockReturnValue({
      rows: [
        {
          kind: "command",
          id: "shell-1",
          sessionID: "root",
          command: "sleep 30",
          cwd: "/repo",
          startedAt: 1,
          status: "running",
          active: true,
          location,
        },
      ],
      commands: 1,
      now: 65_001,
      terminals: 0,
      owners: new Map(),
      terminalsSupported: true,
    });
    render(
      <ProcessFooterControl
        session={{ id: "root", location } as PalotSession}
        sessionIDs={new Set(["root"])}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Commands & terminals: 1 command" });
    fireEvent.click(trigger);
    expect(await screen.findByRole("region", { name: "Running commands" })).toBeTruthy();
    expect(screen.getByText("1m 5s")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /sleep 30/ }));
    expect(mocks.openTab).toHaveBeenCalledWith(
      { kind: "command", location, shellID: "shell-1", sessionID: "root", command: "sleep 30" },
      { pane: "bottom" },
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("opens child terminals as read-only persistent tabs without changing their owner", async () => {
    const location = { directory: "/child" };
    mocks.processes.mockReturnValue({
      rows: [
        {
          kind: "terminal",
          id: "pty-1",
          sessionID: "child",
          title: "Dev server",
          command: "zsh",
          status: "running",
          foregroundProcess: "node",
          active: true,
          location,
        },
      ],
      commands: 0,
      terminals: 1,
      owners: new Map([["child", { title: "Build UI" }]]),
      terminalsSupported: true,
    });
    const view = render(
      <ProcessFooterControl
        session={{ id: "parent", location: { directory: "/repo" } } as PalotSession}
        sessionIDs={new Set(["parent", "child"])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Commands & terminals: 1 terminal" }));
    expect(await screen.findByRole("region", { name: "Terminals" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Dev server.*Build UI/ }));
    expect(mocks.openTab).toHaveBeenLastCalledWith(
      {
        kind: "terminal",
        location,
        ptyID: "pty-1",
        sessionID: "child",
        transport: "persistent",
        readOnly: true,
      },
      { pane: "bottom" },
    );
    view.unmount();
  });
});
