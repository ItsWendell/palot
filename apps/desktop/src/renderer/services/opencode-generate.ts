import type { ModelRef } from "@opencode/client";
import { openCodeClient } from "./opencode-client";
import { openCodeRequestSignal } from "./opencode-request";

/**
 * Task-free text generation through OpenCode `generate.text`. Without a model, OpenCode
 * picks its default model.
 */
export async function generateOpenCodeText(
  input: { prompt: string; model?: ModelRef | null },
  connectionID?: string,
  requestSignal?: AbortSignal,
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
    { signal: openCodeRequestSignal(requestSignal, 90_000) },
  );
  return result.text;
}
