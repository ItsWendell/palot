import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { buildSwitchingPrompt } from "../lib/switching-prompt";
import { palot } from "../services/palot";
import { SwitchingDialog } from "./switching-dialog";

const services = vi.hoisted(() => ({
  openSession: vi.fn().mockResolvedValue(undefined),
  cacheSession: vi.fn(),
  createChatSession: vi.fn(),
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ openSession: services.openSession }),
}));
vi.mock("../hooks/use-session-catalog", () => ({
  useProjectCatalog: () => [
    {
      id: "project-1",
      canonical: "/repo/one",
      name: "One",
      sandboxes: [],
      vcs: null,
      updatedAt: 1,
    },
  ],
  useSessionCatalog: () => [],
  useCacheSession: () => services.cacheSession,
}));
vi.mock("../services/opencode-chats", () => ({
  createChatSession: services.createChatSession,
}));
vi.mock("../lib/clipboard", () => ({ writeClipboardText: services.writeClipboardText }));

const runtime = {
  connectionID: "origin",
  profileID: "origin-profile",
  connected: true,
} as OpenCodeRuntimeStatus;

const created = (directory: string): PalotSession => ({
  id: "switch-task",
  parentID: null,
  projectID: "project-1",
  title: null,
  agent: null,
  model: null,
  location: { directory },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});

function renderDialog() {
  const store = createStore();
  store.set(runtimeAtom, runtime);
  const onClose = vi.fn();
  render(
    <Provider store={store}>
      <SwitchingDialog onClose={onClose} />
    </Provider>,
  );
  return { onClose };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("SwitchingDialog", () => {
  it("starts a titled task without a project and sends the prompt", async () => {
    const user = userEvent.setup();
    services.createChatSession.mockResolvedValue(created("/home/me/.palot/chats/x"));
    const rename = vi.spyOn(palot, "renameSession").mockResolvedValue(undefined);
    const send = vi.spyOn(palot, "sendComposerPrompt").mockResolvedValue(undefined);
    const { onClose } = renderDialog();

    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("radio", { name: /Claude Code/ }));
    await user.click(start);

    await waitFor(() => expect(services.openSession).toHaveBeenCalledWith("switch-task"));
    expect(services.createChatSession).toHaveBeenCalledWith(
      expect.objectContaining({ connectionID: "origin" }),
    );
    expect(rename).toHaveBeenCalledWith("switch-task", "Switch from Claude Code");
    expect(send).toHaveBeenCalledWith({
      sessionID: "switch-task",
      text: buildSwitchingPrompt({ source: "claude-code" }),
      delivery: "steer",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("runs in the chosen project folder", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(palot, "createSession").mockResolvedValue(created("/repo/one"));
    vi.spyOn(palot, "renameSession").mockResolvedValue(undefined);
    const send = vi.spyOn(palot, "sendComposerPrompt").mockResolvedValue(undefined);
    renderDialog();

    await user.click(screen.getByRole("radio", { name: /Cursor/ }));
    await user.click(screen.getByRole("combobox", { name: "Run in" }));
    await user.click(await screen.findByRole("option", { name: "One" }));
    await user.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith("/repo/one", undefined, "origin", expect.any(Array));
    expect(services.createChatSession).not.toHaveBeenCalled();
    expect(send.mock.calls[0]?.[0].text).toBe(
      buildSwitchingPrompt({ source: "cursor", directory: "/repo/one" }),
    );
  });

  it("copies the prompt without starting a task", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(palot, "createSession");
    renderDialog();

    await user.click(screen.getByRole("radio", { name: /Codex/ }));
    await user.click(screen.getByRole("button", { name: "Copy prompt" }));

    await waitFor(() =>
      expect(services.writeClipboardText).toHaveBeenCalledWith(
        buildSwitchingPrompt({ source: "codex" }),
      ),
    );
    expect(create).not.toHaveBeenCalled();
    expect(services.createChatSession).not.toHaveBeenCalled();
  });
});
