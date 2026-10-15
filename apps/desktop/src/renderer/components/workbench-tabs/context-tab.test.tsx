import { createStore } from "jotai";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotModel, PalotSession } from "../../../shared";
import { contextMessageTargetAtom, transcriptJumpTargetAtom } from "../../atoms/workbench";
import { runtimeAtom } from "../../atoms/workspace";
import { updateDiagnosticsPreferences } from "../../lib/diagnostics-preferences";
import { createRendererQueryClient } from "../../lib/query-client";
import { renderWithRouter, seedCatalog } from "../../test-utils/render-with-router";
import { ContextTab } from "./context-tab";

const palotMock = vi.hoisted(() => ({
  loadSessionContext: vi.fn(),
  listSessionInstructionEntries: vi.fn(),
  removeSessionInstructionEntry: vi.fn(),
}));

const model: PalotModel = {
  id: "model-1",
  modelID: "model-1",
  providerID: "provider-1",
  name: "Model One",
  family: null,
  variants: [],
  inputLimit: null,
  contextLimit: 1_000_000,
  outputLimit: 10_000,
  releasedAt: 0,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  status: "active",
};

function message(id: string, type: string, extra: Partial<PalotMessage> = {}): PalotMessage {
  return {
    id,
    type,
    createdAt: 20,
    completedAt: 21,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: null,
    ...extra,
  };
}

const assistantTokens = (input: number, read: number) => ({
  model: { id: model.id, providerID: model.providerID },
  tokens: { input, output: 1_000, reasoning: 0, cache: { read, write: 0 } },
});

const messages: PalotMessage[] = [
  message("user-1", "user", { text: "Start" }),
  message("assistant-1", "assistant", assistantTokens(2, 600_000)),
  message("compaction-1", "compaction", {
    content: [{ type: "compaction", status: "completed", reason: "manual", cost: 0.02 }],
  }),
  message("user-2", "user", { text: "Continue" }),
  message("assistant-2", "assistant", assistantTokens(2, 40_000)),
];

vi.mock("../../services/palot", () => ({ palot: palotMock }));
vi.mock("../../hooks/use-model-catalog", () => ({
  useModelCatalog: () => ({
    data: { models: [model], providers: [{ id: "provider-1", name: "Provider One" }] },
  }),
}));
vi.mock("../../hooks/use-session-transcript", () => ({
  useSessionTranscript: () => ({
    messages,
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    isPending: false,
  }),
}));

const session: PalotSession = {
  id: "session-1",
  parentID: null,
  projectID: "project-1",
  title: "Context test",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 20,
  archivedAt: null,
  cost: 1.5,
  tokens: { input: 4, output: 2_000, reasoning: 0, cache: { read: 640_000, write: 0 } },
};

function renderTab() {
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection-1",
    profileID: "profile-1",
    contractVersion: "0.0.0-beta-19425",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version: "0.0.0-beta-19425",
    pid: 1,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  const queryClient = createRendererQueryClient();
  seedCatalog(queryClient, { sessions: [session] }, "connection-1");
  renderWithRouter(
    <ContextTab
      tab={{
        id: "context",
        kind: "context",
        pinned: true,
        resource: { profileID: "profile-1", sessionID: session.id, location: session.location },
      }}
    />,
    store,
    "/new",
    queryClient,
  );
  return store;
}

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.getAnimations = vi.fn(() => []);
  palotMock.loadSessionContext.mockResolvedValue([
    {
      type: "compaction",
      id: "compaction-1",
      time: { created: 1 },
      status: "completed",
      reason: "manual",
      summary: "## Goal\nShip the context tab.",
      recent: "",
    },
    { type: "user", id: "user-2", time: { created: 2 }, text: "Continue with tests" },
  ]);
  palotMock.listSessionInstructionEntries.mockResolvedValue([
    {
      key: "palot.automation",
      value: "## Palot automation\n\nAutomation memory: /home/me/memory.md\n\nRead it first.",
    },
  ]);
  palotMock.removeSessionInstructionEntry.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ContextTab", () => {
  it("shows the window and cost without loaded-message counts or diagnostics", () => {
    renderTab();
    expect(screen.getByText("Context window: 4% used (96% left)")).toBeTruthy();
    expect(screen.getByText("41k / 1M tokens used")).toBeTruthy();
    expect(screen.getByText("Model One · Provider One")).toBeTruthy();
    expect(screen.getAllByText("$1.50").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Loaded messages/)).toBeNull();
    expect(screen.queryByText("Context test")).toBeNull();
    expect(screen.queryByText("Developer diagnostics")).toBeNull();
    expect(palotMock.loadSessionContext).not.toHaveBeenCalled();
  });

  it("lists what the model sees as readable rows with a raw view", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /What the model sees/ }));
    const list = await screen.findByRole("list", { name: "Messages in context" });
    expect(within(list).getByText("Summary")).toBeTruthy();
    expect(within(list).getByText("Goal")).toBeTruthy();
    expect(within(list).getByText("Continue with tests")).toBeTruthy();
    expect(palotMock.loadSessionContext).toHaveBeenCalledWith(
      session.id,
      "connection-1",
      expect.any(AbortSignal),
    );

    const raw = screen.getByRole("button", { name: "View raw" });
    await userEvent.click(raw);
    expect(raw.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/"summary": "## Goal/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Messages in context" })).toBeNull();
  });

  it("removes an instruction only after an in-place confirmation", async () => {
    renderTab();
    const entry = await screen.findByRole("listitem", { name: "Automation" });
    expect(within(entry).getByText("Palot")).toBeTruthy();
    expect(within(entry).getByText("/home/me/memory.md")).toBeTruthy();

    await userEvent.click(within(entry).getByRole("button", { name: "Remove Automation" }));
    expect(palotMock.removeSessionInstructionEntry).not.toHaveBeenCalled();
    await userEvent.click(
      within(entry).getByRole("button", { name: "Confirm removing Automation" }),
    );
    await waitFor(() =>
      expect(palotMock.removeSessionInstructionEntry).toHaveBeenCalledWith(
        session.id,
        "palot.automation",
        "connection-1",
      ),
    );
  });

  it("jumps the transcript to a compaction", async () => {
    const store = renderTab();
    const history = screen.getByRole("list", { name: "Compactions" });
    expect(within(history).getByText(/601k → 41k tokens/)).toBeTruthy();
    await userEvent.click(within(history).getByRole("button", { name: /^Jump to/ }));
    expect(store.get(transcriptJumpTargetAtom)).toEqual({
      sessionID: session.id,
      messageID: "compaction-1",
    });
  });

  it("shows developer diagnostics when Palot diagnostics are on", () => {
    updateDiagnosticsPreferences({ overlayVisible: true });
    try {
      renderTab();
      expect(screen.getByRole("button", { name: /Developer diagnostics/ })).toBeTruthy();
    } finally {
      updateDiagnosticsPreferences({ overlayVisible: false });
    }
  });

  it("reveals the record a timeline cache warning points at", async () => {
    const store = renderTab();
    act(() =>
      store.set(contextMessageTargetAtom, { sessionID: session.id, messageID: "assistant-2" }),
    );
    expect(await screen.findByText(/"id": "assistant-2"/)).toBeTruthy();
    expect(store.get(contextMessageTargetAtom)).toBeNull();
  });
});
