import type { VoiceModel } from "@opencode/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE_VOICE_CALL_SNAPSHOT, type PalotSession } from "../../../shared";
import { runtimeAtom } from "../../atoms/workspace";
import { VoiceCallButton } from "./voice-call-ui";

const mocks = vi.hoisted(() => ({ models: vi.fn(), start: vi.fn() }));

vi.mock("../../services/opencode-client", () => ({
  openCodeClient: () => ({ experimental: { voice: { models: mocks.models } } }),
}));

vi.mock("../../services/voice-call", () => {
  const state = { snapshot: IDLE_VOICE_CALL_SNAPSHOT, transcript: [], lastError: null };
  return {
    VOICE_COORDINATOR_AGENT: "voice-coordinator",
    voiceCall: {
      subscribe: () => () => undefined,
      getState: () => state,
      subscribeLevels: () => () => undefined,
      getLevels: () => ({ input: 0, output: 0 }),
      start: mocks.start,
      end: vi.fn(),
      openSession: vi.fn(),
    },
  };
});

afterEach(() => {
  cleanup();
  mocks.models.mockReset();
  mocks.start.mockReset();
});

const session = { id: "session", title: "Task", agent: "build" } as PalotSession;

function liveModel(available: boolean): VoiceModel {
  return {
    model: "gpt-live-1",
    name: "GPT-Live 1",
    engine: "openai-live",
    provider: "openai",
    transports: ["webrtc"],
    available,
  };
}

function renderButton(version: string) {
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection",
    profileID: "profile",
    contractVersion: "2.2.7",
    phase: "connected",
    connected: true,
    binaryPath: null,
    version,
    pid: null,
    managed: false,
    lastConnectedAt: null,
    error: null,
    versionMismatch: null,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <VoiceCallButton session={session} connectionID="connection" projectName={null} supported />
      </Provider>
    </QueryClientProvider>,
  );
  return screen.getByRole("button", { name: "Start voice chat" });
}

describe("VoiceCallButton", () => {
  it("stays visible but disabled, and says why, when the server can't start a voice model", async () => {
    mocks.models.mockResolvedValue({ models: [liveModel(false)] });
    const button = renderButton("2.2.7");
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    await userEvent.click(button);
    expect(mocks.start).not.toHaveBeenCalled();
    await userEvent.hover(button);
    expect(
      await screen.findByText(/needs an OpenAI API key.*Add one in Settings → Providers\./),
    ).toBeTruthy();
  });

  it("starts a call when the server can start the model", async () => {
    mocks.models.mockResolvedValue({ models: [liveModel(true)], default: "gpt-live-1" });
    const button = renderButton("2.2.7");
    await waitFor(() => expect(mocks.models).toHaveBeenCalled());
    await userEvent.click(button);
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ connectionID: "connection", sessionID: "session" }),
    );
  });

  it("stays enabled on servers older than the model list", async () => {
    const button = renderButton("2.1.0");
    await userEvent.click(button);
    expect(mocks.models).not.toHaveBeenCalled();
    expect(mocks.start).toHaveBeenCalled();
  });
});
