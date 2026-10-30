import type { ModelRef } from "@opencode/client";
import { isMissingOpenCodeRoute } from "../../shared/opencode-missing-route";
import { openCodeClient, openCodeConnectionFetch } from "./opencode-client";
import { openCodeRequestSignal } from "./opencode-request";

/** Long enough for a commit message; longer jobs pass their own timeout. */
const DEFAULT_GENERATE_TIMEOUT_MS = 90_000;

/** OpenCode before 2.2.0 served `generate.text` here; 2.2.0 keeps it as an alias. */
const LEGACY_GENERATE_PATH = "/api/experimental/generate";

/**
 * Task-free text generation through OpenCode `generate.text`. Without a model, OpenCode
 * picks its default model.
 */
export async function generateOpenCodeText(
  input: { prompt: string; model?: ModelRef | null },
  connectionID?: string,
  requestSignal?: AbortSignal,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  const { model } = input;
  const body = {
    prompt: input.prompt,
    ...(model
      ? {
          model: {
            id: model.id,
            providerID: model.providerID,
            ...(model.variant ? { variant: model.variant } : {}),
          },
        }
      : {}),
  };
  const signal = openCodeRequestSignal(
    requestSignal,
    options.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS,
  );
  try {
    return (await openCodeClient(connectionID).experimental.generate.text(body, { signal })).text;
  } catch (error) {
    if (!isMissingOpenCodeRoute(error)) throw error;
  }
  // A server older than 2.2.0 has only the original route.
  const response = await openCodeConnectionFetch(connectionID, LEGACY_GENERATE_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const result = (await response.json().catch(() => null)) as {
    data?: { text?: unknown };
    message?: unknown;
  } | null;
  if (!response.ok || typeof result?.data?.text !== "string")
    throw new Error(
      typeof result?.message === "string"
        ? result.message
        : `OpenCode could not generate text (HTTP ${response.status}).`,
    );
  return result.data.text;
}
