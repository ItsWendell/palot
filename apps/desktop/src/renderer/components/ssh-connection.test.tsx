import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SshConnectionState } from "../../shared/ssh-contract";
import { palot } from "../services/palot";
import { SshConnectionDialog } from "./ssh-connection-dialog";
import { SshPrompts } from "./ssh-prompts";

vi.mock("../services/palot", () => ({
  palot: {
    testOpenCodeProfile: vi.fn(),
    createOpenCodeProfile: vi.fn(),
    updateOpenCodeProfile: vi.fn(),
    getSshConnectionState: vi.fn(),
    onSshConnectionState: vi.fn(),
    respondSshPrompt: vi.fn(),
    cancelSshConnection: vi.fn(),
  },
}));
vi.mock("./ui/toast", () => ({ toast: { add: vi.fn() } }));

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

describe("SSH profile editor", () => {
  it("updates an existing SSH profile only after a successful test", async () => {
    vi.mocked(palot.testOpenCodeProfile).mockResolvedValue({
      version: "test",
      url: "http://localhost",
      pid: 1,
      secure: true,
    });
    render(
      <SshConnectionDialog
        profile={{ id: "ssh-1", kind: "ssh", name: "Work", ssh: { target: "old-host" } }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("SSH target"), { target: { value: "new-host" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and save" }));
    await waitFor(() =>
      expect(palot.updateOpenCodeProfile).toHaveBeenCalledWith({
        id: "ssh-1",
        kind: "ssh",
        name: "Work",
        ssh: { target: "new-host" },
      }),
    );
    expect(palot.createOpenCodeProfile).not.toHaveBeenCalled();
  });

  it("tests before saving the SSH configuration", async () => {
    let finish!: () => void;
    vi.mocked(palot.testOpenCodeProfile).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ version: "test", url: "http://localhost", pid: 1, secure: true });
        }),
    );
    const saved = vi.fn();
    render(<SshConnectionDialog onClose={vi.fn()} onSaved={saved} />);
    fireEvent.change(screen.getByLabelText("SSH target"), { target: { value: " dev-box " } });
    fireEvent.change(screen.getByLabelText("Port (optional)"), { target: { value: "2222" } });
    fireEvent.change(screen.getByLabelText("Identity file (optional)"), {
      target: { value: "~/.ssh/work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test and save" }));
    expect(palot.createOpenCodeProfile).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(palot.createOpenCodeProfile).toHaveBeenCalledWith({
      kind: "ssh",
      name: "dev-box",
      ssh: { target: "dev-box", port: 2222, identityFile: "~/.ssh/work" },
    });
    expect(saved).toHaveBeenCalledOnce();
  });

  it.each(["Connection failed", "SSH connection cancelled"])(
    "does not change a saved profile after %s",
    async (message) => {
      vi.mocked(palot.testOpenCodeProfile).mockRejectedValue(new Error(message));
      render(
        <SshConnectionDialog
          profile={{ id: "ssh-1", kind: "ssh", name: "Work", ssh: { target: "old-host" } }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
      fireEvent.change(screen.getByLabelText("SSH target"), { target: { value: "new-host" } });
      fireEvent.click(screen.getByRole("button", { name: "Test and save" }));
      await screen.findByRole("alert");
      expect(palot.updateOpenCodeProfile).not.toHaveBeenCalled();
      expect(palot.createOpenCodeProfile).not.toHaveBeenCalled();
    },
  );

  it("does not save a test that completes after the editor unmounts", async () => {
    let finish!: () => void;
    vi.mocked(palot.testOpenCodeProfile).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ version: "test", url: "http://localhost", pid: 1, secure: true });
        }),
    );
    const view = render(<SshConnectionDialog onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("SSH target"), { target: { value: "dev-box" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and save" }));
    view.unmount();
    await act(async () => finish());
    expect(palot.createOpenCodeProfile).not.toHaveBeenCalled();
  });
});

describe("SSH prompts", () => {
  let emit: (state: SshConnectionState | null) => void;
  const state = (id: string): SshConnectionState => ({
    operationID: "op-1",
    target: "work",
    stage: "Authenticating",
    prompt: { id, request: { kind: "authentication", text: "Password:", confirm: false } },
  });
  beforeEach(() => {
    vi.mocked(palot.onSshConnectionState).mockImplementation((listener) => {
      emit = listener;
      return vi.fn();
    });
    vi.mocked(palot.getSshConnectionState).mockResolvedValue(null);
    vi.mocked(palot.respondSshPrompt).mockResolvedValue(undefined);
    vi.mocked(palot.cancelSshConnection).mockResolvedValue(undefined);
  });

  it("subscribes before hydration and ignores a stale snapshot", async () => {
    let hydrate!: (state: SshConnectionState | null) => void;
    vi.mocked(palot.getSshConnectionState).mockImplementation(() => {
      expect(emit).toBeTypeOf("function");
      return new Promise((resolve) => {
        hydrate = resolve;
      });
    });
    render(<SshPrompts />);
    act(() => emit(state("new")));
    await act(async () => hydrate(null));
    expect(screen.getByLabelText("SSH answer")).toBeTruthy();
  });

  it("conceals answers and clears them on prompt changes and close", async () => {
    render(<SshPrompts />);
    act(() => emit(state("first")));
    const input = screen.getByLabelText("SSH answer") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "secret" } });
    act(() => emit(state("second")));
    expect((screen.getByLabelText("SSH answer") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("SSH answer"), { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(palot.respondSshPrompt).toHaveBeenCalledWith({
        operationID: "op-1",
        promptID: "second",
        value: "new-secret",
      }),
    );
    expect((screen.getByLabelText("SSH answer") as HTMLInputElement).value).toBe("");
    act(() => emit(null));
    act(() => emit(state("third")));
    expect((screen.getByLabelText("SSH answer") as HTMLInputElement).value).toBe("");
  });

  it.each(["install", "start", "replace"] as const)(
    "requires explicit %s consent",
    async (action) => {
      render(<SshPrompts />);
      act(() =>
        emit({
          ...state("setup"),
          prompt: { id: "setup", request: { kind: "setup", action, version: "19381" } },
        }),
      );
      expect(palot.respondSshPrompt).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: `Allow ${action}` }));
      await waitFor(() =>
        expect(palot.respondSshPrompt).toHaveBeenCalledWith({
          operationID: "op-1",
          promptID: "setup",
          value: "yes",
        }),
      );
    },
  );

  it("cancels the operation without sending consent", async () => {
    render(<SshPrompts />);
    act(() => emit(state("auth")));
    fireEvent.click(screen.getByRole("button", { name: "Cancel connection" }));
    await waitFor(() => expect(palot.cancelSshConnection).toHaveBeenCalledWith("op-1"));
    expect(palot.respondSshPrompt).not.toHaveBeenCalled();
  });

  it("hydrates a host verification prompt and sends confirmation only on click", async () => {
    vi.mocked(palot.getSshConnectionState).mockResolvedValue({
      ...state("host"),
      prompt: {
        id: "host",
        request: { kind: "authentication", text: "Trust this host key?", confirm: true },
      },
    });
    const unsubscribe = vi.fn();
    vi.mocked(palot.onSshConnectionState).mockReturnValue(unsubscribe);
    const view = render(<SshPrompts />);
    await screen.findByText("Trust this host key?");
    expect(screen.queryByLabelText("SSH answer")).toBeNull();
    expect(palot.respondSshPrompt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(palot.respondSshPrompt).toHaveBeenCalledWith({
        operationID: "op-1",
        promptID: "host",
        value: "yes",
      }),
    );
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
