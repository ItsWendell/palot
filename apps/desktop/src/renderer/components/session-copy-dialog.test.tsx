import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { SessionCopyDialog } from "./session-copy-dialog";

const fixtures = vi.hoisted(() => ({
  connections: [] as unknown[],
  included: [] as string[],
  copy: vi.fn(),
  cache: vi.fn(),
  openSession: vi.fn(),
}));

vi.mock("../hooks/use-connection-overview", () => ({
  useConnectionOverview: () => ({
    connections: fixtures.connections,
    includedProfileIDs: fixtures.included,
  }),
}));
vi.mock("../hooks/use-session-catalog", () => ({
  useCacheSession: (owner: OpenCodeRuntimeStatus | null) => (session: PalotSession) =>
    fixtures.cache(owner?.connectionID, session),
}));
vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ openSession: fixtures.openSession }),
}));
vi.mock("../services/opencode-session-copy", () => ({
  copySessionToServer: fixtures.copy,
}));

function runtime(profileID: string, connected = true): OpenCodeRuntimeStatus {
  return {
    profileID,
    connectionID: `connection-${profileID}`,
    connected,
    phase: connected ? "connected" : "stopped",
    contractVersion: "2.0.3",
    version: "2.0.3",
    binaryPath: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  };
}

function destination(id: string, connected = true) {
  return {
    profile: { id, name: `Server ${id.toUpperCase()}` },
    runtime: runtime(id, connected),
    projects: [
      {
        id: "same-project",
        name: `Project ${id.toUpperCase()}`,
        canonical: `/srv/${id}`,
        sandboxes: [],
        vcs: null,
        updatedAt: null,
      },
    ],
  };
}

const session: PalotSession = {
  id: "source-task",
  projectID: "same-project",
  title: "Original",
  parentID: null,
  location: { directory: "/source/repo" },
  agent: null,
  model: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};
const copied = { ...session, location: { directory: "/srv/b" } };

function setup() {
  const onClose = vi.fn();
  const view = (source = runtime("a")) => (
    <SessionCopyDialog session={session} source={source} onClose={onClose} />
  );
  const result = render(view());
  return { onClose, rerender: (source?: OpenCodeRuntimeStatus) => result.rerender(view(source)) };
}

async function chooseServer(id: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Destination server" }));
  await user.click(screen.getByRole("option", { name: `Server ${id.toUpperCase()}` }));
}

beforeEach(() => {
  fixtures.connections = [
    destination("a"),
    destination("b"),
    destination("c"),
    destination("disabled"),
    destination("offline", false),
  ];
  fixtures.included = ["a", "b", "c", "offline"];
  fixtures.copy.mockReset().mockResolvedValue(copied);
  fixtures.cache.mockReset();
  fixtures.openSession.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("SessionCopyDialog", () => {
  it("retries opening a successful copy without importing again after navigation fails", async () => {
    fixtures.openSession.mockRejectedValueOnce(new Error("Destination is offline"));
    const { onClose, rerender } = setup();
    await chooseServer("b");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Destination folder" }), "/srv/b");
    await user.click(screen.getByRole("button", { name: "Copy task" }));
    expect((await screen.findByRole("alert")).textContent).toContain("task was copied to Server B");
    expect(screen.getByRole("alert").textContent).toContain("Destination is offline");
    expect(onClose).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("combobox", { name: "Destination server" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("textbox", { name: "Destination folder" }) as HTMLInputElement).disabled,
    ).toBe(true);
    fixtures.connections = [destination("a"), destination("b", false), destination("c")];
    rerender(runtime("c"));
    await user.click(screen.getByRole("button", { name: "Open copied task" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fixtures.copy).toHaveBeenCalledOnce();
    expect(fixtures.cache).toHaveBeenCalledOnce();
    expect(fixtures.openSession.mock.calls).toEqual([
      [copied.id, { profileID: "b" }],
      [copied.id, { profileID: "b" }],
    ]);
  });

  it("selects the destination server and its project without reusing the source path", async () => {
    const { onClose } = setup();
    await chooseServer("b");
    const input = screen.getByRole("textbox", { name: "Destination folder" }) as HTMLInputElement;
    expect(input.value).toBe("");
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Destination project" }));
    await user.click(screen.getByRole("option", { name: "Project B" }));
    expect(input.value).toBe("/srv/b");
    await user.click(screen.getByRole("button", { name: "Copy task" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fixtures.copy).toHaveBeenCalledWith({
      sessionID: session.id,
      sourceConnectionID: "connection-a",
      destinationConnectionID: "connection-b",
      location: { directory: "/srv/b" },
    });
    expect(fixtures.cache).toHaveBeenCalledWith("connection-b", copied);
    expect(fixtures.openSession).toHaveBeenCalledWith(copied.id, { profileID: "b" });
  });

  it("clears a previously entered destination path when changing servers", async () => {
    setup();
    await chooseServer("b");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Destination folder" }), "/only-on-b");
    await chooseServer("c");
    expect(
      (screen.getByRole("textbox", { name: "Destination folder" }) as HTMLInputElement).value,
    ).toBe("");
    expect((screen.getByRole("button", { name: "Copy task" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(fixtures.copy).not.toHaveBeenCalled();
  });

  it.each(["disabled", "offline"])(
    "cannot submit after the selected destination becomes %s",
    async (state) => {
      const { rerender } = setup();
      const user = userEvent.setup();
      await user.click(screen.getByRole("combobox", { name: "Destination server" }));
      expect(screen.queryByRole("option", { name: "Server A" })).toBeNull();
      expect(screen.queryByRole("option", { name: "Server DISABLED" })).toBeNull();
      expect(screen.queryByRole("option", { name: "Server OFFLINE" })).toBeNull();
      await user.click(screen.getByRole("option", { name: "Server B" }));
      await user.type(screen.getByRole("textbox", { name: "Destination folder" }), "/srv/b");
      if (state === "disabled") fixtures.included = ["a", "c"];
      else fixtures.connections = [destination("a"), destination("b", false), destination("c")];
      rerender();
      const button = screen.getByRole("button", { name: "Copy task" }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      await user.click(button);
      expect(fixtures.copy).not.toHaveBeenCalled();
    },
  );

  it("keeps source, destination and cache ownership captured while the copy is pending", async () => {
    const pending = Promise.withResolvers<PalotSession>();
    fixtures.copy.mockReturnValue(pending.promise);
    const { rerender, onClose } = setup();
    await chooseServer("b");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Destination folder" }), "/srv/b");
    await user.click(screen.getByRole("button", { name: "Copy task" }));
    expect(
      (screen.getByRole("combobox", { name: "Destination server" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("textbox", { name: "Destination folder" }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fixtures.connections = [
      destination("a"),
      { ...destination("b"), runtime: { ...runtime("b"), connectionID: "replacement-b" } },
      destination("c"),
    ];
    rerender(runtime("c"));
    await act(async () => pending.resolve(copied));
    expect(fixtures.copy).toHaveBeenCalledOnce();
    expect(fixtures.copy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceConnectionID: "connection-a",
        destinationConnectionID: "connection-b",
      }),
    );
    expect(fixtures.cache).toHaveBeenCalledWith("connection-b", copied);
    expect(fixtures.openSession).toHaveBeenCalledWith(copied.id, { profileID: "b" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("retains the dialog and destination after an error, without caching or navigating", async () => {
    fixtures.copy.mockRejectedValue(new Error("A task with this ID already exists"));
    const { onClose } = setup();
    await chooseServer("b");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Destination folder" }), "/srv/b");
    await user.click(screen.getByRole("button", { name: "Copy task" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already exists");
    expect(screen.getByRole("dialog", { name: "Copy task to server" })).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: "Destination folder" }) as HTMLInputElement).value,
    ).toBe("/srv/b");
    expect(onClose).not.toHaveBeenCalled();
    expect(fixtures.cache).not.toHaveBeenCalled();
    expect(fixtures.openSession).not.toHaveBeenCalled();
  });
});
