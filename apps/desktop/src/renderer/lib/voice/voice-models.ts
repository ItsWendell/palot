import type { ExperimentalVoiceModelsOutput, VoiceModel } from "@opencode/client";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { isMissingOpenCodeRoute } from "../../../shared/opencode-missing-route";
import { openCodeClient } from "../../services/opencode-client";
import { openCodeKeys } from "../opencode-query";

/** Palot's preferred voice model: GPT-Live, the only family that supports client delegation. */
export const VOICE_MODEL = "gpt-live-1";

export const VOICE_MODELS_STALE_TIME = 5 * 60_000;

/**
 * What a call can start with on one connection. `unknown` keeps the behaviour from before
 * servers listed their voice models: offer voice and start the preferred model.
 */
export type VoiceModelChoice =
  | { status: "unknown"; model: string }
  | { status: "ready"; model: string }
  | { status: "unavailable"; kind: "needs-key" | "unsupported"; reason: string };

/** The list, or `unavailable` when the server has no `voice.models` route. */
export type VoiceModelsResult = ExperimentalVoiceModelsOutput | "unavailable";

/** OpenCode 2.1.3 added `experimental.voice.models`. Null when the version doesn't say. */
export function supportsVoiceModels(version: string | null | undefined): boolean | null {
  const match = version?.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  if (major !== 2) return major > 2;
  return minor > 1 || (minor === 1 && patch >= 3);
}

/**
 * Palot's voice client speaks GPT-Live's data-channel protocol over WebRTC, so other model
 * families are not usable even when they offer WebRTC. OpenCode 2.4.0 reports each model's
 * `engine` (`openai-live` for GPT-Live) and lists models from models.dev; older servers send
 * no engine, so the model name decides there.
 */
export function isSupportedVoiceModel(model: VoiceModel): boolean {
  const engine = (model as { engine?: unknown }).engine;
  const live =
    typeof engine === "string"
      ? engine === "openai-live"
      : model.model === "gpt-live" || model.model.startsWith("gpt-live-");
  return live && model.transports.includes("webrtc");
}

/** Supported models the server can start, the preferred one first. */
export function startableVoiceModels(list: ExperimentalVoiceModelsOutput): string[] {
  const models = list.models
    .filter((model) => model.available && isSupportedVoiceModel(model))
    .map((model) => model.model);
  return models.includes(VOICE_MODEL)
    ? [VOICE_MODEL, ...models.filter((model) => model !== VOICE_MODEL)]
    : models;
}

// OpenCode starts GPT-Live with an OpenAI key or, without one, through OpenCode Console.
function missingKeyReason(provider: string | undefined): string {
  if (!provider || provider === "openai") {
    return "Voice chat needs an OpenAI API key or an OpenCode Console connection on the OpenCode server. ChatGPT sign-in can't start voice sessions.";
  }
  return `Voice chat needs a ${provider} API key on the OpenCode server.`;
}

/** Picks the preferred model when the server can start it, otherwise another usable one. */
export function chooseVoiceModel(result: VoiceModelsResult | undefined): VoiceModelChoice {
  if (result === undefined || result === "unavailable") {
    return { status: "unknown", model: VOICE_MODEL };
  }
  const [model] = startableVoiceModels(result);
  if (model) return { status: "ready", model };
  const supported = result.models.filter(isSupportedVoiceModel);
  if (supported.length === 0) {
    return {
      status: "unavailable",
      kind: "unsupported",
      reason: "This OpenCode server doesn't offer a voice model Palot can use.",
    };
  }
  // The server reports no reason; a listed but unavailable model means its provider has no key.
  const listed = supported.find((entry) => entry.model === VOICE_MODEL) ?? supported[0];
  return { status: "unavailable", kind: "needs-key", reason: missingKeyReason(listed?.provider) };
}

export function voiceModelsQueryOptions(connectionID: string, enabled = true) {
  return queryOptions({
    queryKey: openCodeKeys.voiceModels(connectionID),
    queryFn: async ({ signal }): Promise<VoiceModelsResult> => {
      try {
        return await openCodeClient(connectionID).experimental.voice.models({ signal });
      } catch (error) {
        if (isMissingOpenCodeRoute(error)) return "unavailable";
        throw error;
      }
    },
    enabled,
    staleTime: VOICE_MODELS_STALE_TIME,
    retry: false,
  });
}

/**
 * The model a call on this connection starts. Old servers, a missing route and a failed read
 * all fall back to the preferred model, so the session request reports any real problem.
 */
export async function resolveVoiceModel(
  queryClient: QueryClient,
  connectionID: string,
  version: string | null | undefined,
): Promise<VoiceModelChoice> {
  if (supportsVoiceModels(version) === false) return chooseVoiceModel(undefined);
  try {
    return chooseVoiceModel(await queryClient.fetchQuery(voiceModelsQueryOptions(connectionID)));
  } catch {
    return chooseVoiceModel(undefined);
  }
}
