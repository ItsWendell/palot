import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { RunningWorkPanel, useRunningWork, type RunningWorkScope } from "./running-work-control";
import type { BackgroundWorkItem } from "./subagent-activity";

/** The composer's background tab and its panel, as the thread wires them. */
function RunningWorkTab(props: Omit<RunningWorkScope, "open">) {
  const [open, setOpen] = useState(false);
  const work = useRunningWork({ ...props, open });
  if (!work.visible) return null;
  return (
    <>
      <button
        type="button"
        aria-label={`Running work: ${work.label}`}
        onClick={() => setOpen(!open)}
      />
      {open ? <RunningWorkPanel work={work} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const mocks = vi.hoisted(() => ({
  processes: vi.fn(),
  openSession: vi.fn(),
  openTab: vi.fn(),
  client: vi.fn(),
  interrupt: vi.fn(),
  remove: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../hooks/use-session-processes", () => ({
  useSessionProcesses: (...args: unknown[]) => mocks.processes(...args),
}));
vi.mock("../hooks/use-session-catalog", () => ({ useChildSessions: vi.fn() }));
vi.mock("../hooks/use-session-requests", () => ({ useSessionFamilyRequestViews: () => [] }));
vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ openSession: mocks.openSession }),
}));
vi.mock("../atoms/workbench", () => ({ useWorkbenchCommands: () => ({ openTab: mocks.openTab }) }));
vi.mock("../services/opencode-client", () => ({
  openCodeClient: (id: string) => {
    mocks.client(id);
    return {
      session: { interrupt: mocks.interrupt },
      shell: { remove: mocks.remove },
      experimental: { job: { cancel: mocks.cancel } },
    };
  },
}));

const agent: BackgroundWorkItem = {
  kind: "subagent",
  id: "child",
  agent: "Explore",
  description: "Inspect files",
  startedAt: 1,
  fallbackStatus: "running",
  background: true,
};
const command = {
  kind: "command",
  id: "shell",
  sessionID: "child",
  command: "sleep 30",
  cwd: "/child",
  startedAt: 1,
  status: "running",
  active: true,
  location: { directory: "/child" },
};
function setup(items: BackgroundWorkItem[] = [agent]) {
  const store = createStore();
  store.set(runtimeAtom, {
    connected: true,
    connectionID: "origin",
    profileID: "profile-origin",
  } as never);
  const view = render(
    <Provider store={store}>
      <RunningWorkTab
        session={{ id: "root", location: { directory: "/root" } } as PalotSession}
        sessionIDs={new Set(["root", "child"])}
        items={items}
        connectionID="origin"
        profileID="profile-origin"
      />
    </Provider>,
  );
  return { ...view, store };
}
describe("running work", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processes.mockReturnValue({
      rows: [command],
      commands: 1,
      scripts: 0,
      terminals: 0,
      owners: new Map([["child", { title: "Child" }]]),
      terminalsSupported: true,
    });
    mocks.openTab.mockReturnValue({ ok: true });
    mocks.interrupt.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("uses one indicator, opens owned children and commands, and directly stops an individual child", async () => {
    setup();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const trigger = screen.getByRole("button", { name: "Running work: 2 running" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Stop Inspect files" }));
    await waitFor(() => expect(mocks.interrupt).toHaveBeenCalledWith({ sessionID: "child" }));
    expect(mocks.client).toHaveBeenCalledWith("origin");
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Inspect files.*Explore/ }));
    expect(mocks.openSession).toHaveBeenCalledWith("child", { profileID: "profile-origin" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: /sleep 30.*Child/ }));
    expect(mocks.openTab).toHaveBeenCalledWith(
      {
        kind: "command",
        shellID: "shell",
        sessionID: "child",
        command: "sleep 30",
        location: { directory: "/child" },
      },
      { pane: "bottom" },
    );
  });
  it("stops only the selected command at its own location and keeps failures on that row", async () => {
    mocks.remove.mockRejectedValue(new Error("Cannot stop shell"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Running work: 2 running" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop sleep 30" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Cannot stop shell");
    expect(mocks.remove).toHaveBeenCalledWith({ id: "shell", location: { directory: "/child" } });
    expect(mocks.client).toHaveBeenCalledWith("origin");
    expect(mocks.interrupt).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Stop Inspect files" }).hasAttribute("disabled"),
    ).toBe(false);
  });
  it("does not stop work on a newly focused other connection", async () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Running work: 2 running" }));
    const stop = await screen.findByRole("button", { name: "Stop Inspect files" });
    act(() =>
      store.set(runtimeAtom, {
        connected: true,
        profileID: "other",
        connectionID: "other",
      } as never),
    );
    fireEvent.click(stop);
    expect(mocks.interrupt).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("keeps recently finished commands and child terminals available without stop actions", async () => {
    mocks.processes.mockReturnValue({
      rows: [
        { ...command, active: false, status: "exited" },
        // A renamed terminal shows its user title over the shell's automatic one.
        { ...command, kind: "terminal", id: "pty", title: "zsh", userTitle: "Dev server" },
      ],
      commands: 0,
      scripts: 0,
      terminals: 1,
      owners: new Map(),
      terminalsSupported: true,
    });
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Running work: 1 terminal" }));
    expect(await screen.findByRole("region", { name: "Recently finished" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Stop / })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Dev server/ }));
    expect(mocks.openTab).toHaveBeenCalledWith(
      {
        kind: "terminal",
        ptyID: "pty",
        sessionID: "child",
        location: { directory: "/child" },
        transport: "persistent",
        readOnly: true,
      },
      { pane: "bottom" },
    );
  });
  it("lists a background script by its calls and stops it through its job", async () => {
    mocks.processes.mockReturnValue({
      rows: [
        {
          kind: "script",
          id: "cm_1",
          sessionID: "child",
          title: "Shell ./slow.sh",
          startedAt: 1,
          location: { directory: "/child" },
          active: true,
        },
      ],
      commands: 0,
      scripts: 1,
      terminals: 0,
      owners: new Map(),
      terminalsSupported: true,
    });
    mocks.cancel.mockResolvedValue(undefined);
    setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Running work: 1 running" }));
    expect(await screen.findByRole("region", { name: "Background scripts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop Shell ./slow.sh" }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith({ id: "cm_1" }));
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
