import { createStore } from "jotai";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotSession } from "../../../shared";
import { runtimeAtom } from "../../atoms/workspace";
import { createRendererQueryClient } from "../../lib/query-client";
import { renderWithRouter, seedCatalog } from "../../test-utils/render-with-router";
import { ContextTab } from "./context-tab";

const palotMock = vi.hoisted(() => ({
  loadSessionContext: vi.fn().mockResolvedValue([{ id: "retained-message" }]),
  listSessionInstructionEntries: vi.fn().mockResolvedValue([]),
  removeSessionInstructionEntry: vi.fn().mockResolvedValue(undefined),
}));

const message: PalotMessage = {
  id: "message-1",
  type: "assistant",
  createdAt: 20,
  completedAt: 21,
  text: "Done",
  agent: null,
  model: null,
  tokens: {
    input: 10,
    output: 5,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
  finish: null,
  content: [],
  data: null,
};

vi.mock("../../services/palot", () => ({ palot: palotMock }));
vi.mock("../../hooks/use-model-catalog", () => ({
  useModelCatalog: () => ({ data: { models: [], providers: [] } }),
}));
vi.mock("../../hooks/use-session-transcript", () => ({
  useSessionTranscript: () => ({
    messages: [message],
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    isPending: false,
  }),
}));

beforeEach(() => {
  Element.prototype.getAnimations = vi.fn(() => []);
});

afterEach(() => {
  cleanup();
  palotMock.loadSessionContext.mockClear();
  palotMock.listSessionInstructionEntries.mockClear();
});

describe("ContextTab", () => {
  it("lazy-loads context details and keeps mapped records collapsed", async () => {
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
      cost: null,
      tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, { sessions: [session] }, "connection-1");

    renderWithRouter(
      <ContextTab
        tab={{
          id: "context",
          kind: "context",
          pinned: true,
          resource: {
            profileID: "profile-1",
            sessionID: session.id,
            location: session.location,
          },
        }}
      />,
      store,
      "/new",
      queryClient,
    );

    expect(screen.queryByText(/Workspace files/)).toBeNull();
    expect(palotMock.loadSessionContext).not.toHaveBeenCalled();
    expect(screen.queryByText("message-1")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Post-compaction context/ }));
    await waitFor(() => expect(palotMock.loadSessionContext).toHaveBeenCalledWith(session.id));
    expect(await screen.findByText(/retained-message/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Projected message records/ }));
    expect(screen.getByText(/message-1/)).toBeTruthy();
    expect(screen.queryByText(/"text": "Done"/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /assistant.*message-1/i }));
    expect(await screen.findByText(/"text": "Done"/)).toBeTruthy();
  });
});
