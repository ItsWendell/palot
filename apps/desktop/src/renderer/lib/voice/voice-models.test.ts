import { ClientError, type VoiceModel } from "@opencode/client";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseVoiceModel, resolveVoiceModel, VOICE_MODEL } from "./voice-models";

const mocks = vi.hoisted(() => ({ models: vi.fn() }));

vi.mock("../../services/opencode-client", () => ({
  openCodeClient: () => ({ experimental: { voice: { models: mocks.models } } }),
}));

afterEach(() => mocks.models.mockReset());

function model(name: string, available: boolean, overrides: Partial<VoiceModel> = {}): VoiceModel {
  return {
    model: name,
    name,
    engine: name.startsWith("gpt-live") ? "openai-live" : "openai-realtime",
    provider: "openai",
    transports: ["webrtc"],
    available,
    ...overrides,
  };
}

const realtime = (available: boolean) =>
  model("gpt-realtime-2.1", available, { transports: ["webrtc", "websocket"] });

describe("chooseVoiceModel", () => {
  it("starts the preferred model when the server can start it", () => {
    expect(
      chooseVoiceModel({
        models: [realtime(true), model(VOICE_MODEL, true)],
        default: VOICE_MODEL,
      }),
    ).toEqual({ status: "ready", model: VOICE_MODEL });
  });

  it("explains a missing key when the preferred model is listed but can't start", () => {
    const choice = chooseVoiceModel({ models: [model(VOICE_MODEL, false), realtime(false)] });
    expect(choice).toMatchObject({ status: "unavailable", kind: "needs-key" });
    expect(choice.status === "unavailable" && choice.reason).toMatch(/OpenAI API key/);
  });

  it("falls back to another startable model Palot's client speaks", () => {
    expect(
      chooseVoiceModel({ models: [model(VOICE_MODEL, false), model("gpt-live-2", true)] }),
    ).toEqual({ status: "ready", model: "gpt-live-2" });
  });

  it("does not pick startable models whose protocol or transport Palot doesn't speak", () => {
    const choice = chooseVoiceModel({
      models: [
        model(VOICE_MODEL, false),
        realtime(true),
        model("gpt-live-ws", true, { transports: ["websocket"] }),
        model("grok-voice-3.0", true, { provider: "xai", transports: ["websocket"] }),
      ],
    });
    expect(choice).toMatchObject({ status: "unavailable", kind: "needs-key" });
  });

  it("follows the engine a 2.4 server reports, and the model name on older servers", () => {
    expect(
      chooseVoiceModel({
        models: [
          model("gpt-live-preview", true, { engine: "openai-realtime" }),
          model("live-voice-1.1", true, { engine: "openai-live" }),
        ],
      }),
    ).toEqual({ status: "ready", model: "live-voice-1.1" });
    const legacy = model("gpt-live-1.1", true) as Partial<VoiceModel>;
    delete legacy.engine;
    delete legacy.name;
    expect(chooseVoiceModel({ models: [legacy as VoiceModel] })).toEqual({
      status: "ready",
      model: "gpt-live-1.1",
    });
  });

  it("says when the server offers no usable voice model at all", () => {
    expect(
      chooseVoiceModel({
        models: [model("gemini-3.8-live", true, { provider: "google", transports: ["websocket"] })],
      }),
    ).toMatchObject({ status: "unavailable", kind: "unsupported" });
  });
});

describe("resolveVoiceModel", () => {
  it("keeps today's model on servers that answer without the route", async () => {
    mocks.models.mockRejectedValue(new ClientError("UnsupportedContentType"));
    await expect(resolveVoiceModel(new QueryClient(), "connection", "2.2.7")).resolves.toEqual({
      status: "unknown",
      model: VOICE_MODEL,
    });
  });

  it("does not ask servers older than the route", async () => {
    await expect(resolveVoiceModel(new QueryClient(), "connection", "2.1.2")).resolves.toEqual({
      status: "unknown",
      model: VOICE_MODEL,
    });
    expect(mocks.models).not.toHaveBeenCalled();
  });

  it("keeps today's model when the list can't be read", async () => {
    mocks.models.mockRejectedValue(new ClientError("Transport"));
    await expect(resolveVoiceModel(new QueryClient(), "connection", "2.2.7")).resolves.toEqual({
      status: "unknown",
      model: VOICE_MODEL,
    });
  });

  it("reads the server's list on current servers", async () => {
    mocks.models.mockResolvedValue({ models: [model(VOICE_MODEL, false)] });
    await expect(
      resolveVoiceModel(new QueryClient(), "connection", "2.1.3"),
    ).resolves.toMatchObject({ status: "unavailable", kind: "needs-key" });
  });
});
