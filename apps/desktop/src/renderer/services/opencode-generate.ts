import type { ModelRef } from "@opencode/client";
import { openCodeClient } from "./opencode-client";
import { openCodeRequestSignal } from "./opencode-request";

/** Long enough for a commit message; longer jobs pass their own timeout. */
const DEFAULT_GENERATE_TIMEOUT_MS = 90_000;

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
  const result = await openCodeClient(connectionID).generate.text(
    {
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
    },
    {
      signal: openCodeRequestSignal(
        requestSignal,
        options.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS,
      ),
    },
  );
  return result.text;
}
