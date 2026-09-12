/** Context-window projection based on the last token-bearing assistant step. */

import type { PalotMessage, PalotModel } from "../../shared";

export interface ContextUsage {
  total: number;
  limit: number | null;
  percentage: number | null;
}

function tokenTotal(message: PalotMessage): number {
  if (!message.tokens) return 0;
  return (
    message.tokens.input +
    message.tokens.output +
    message.tokens.reasoning +
    message.tokens.cache.read +
    message.tokens.cache.write
  );
}

export function getContextUsage(
  messages: PalotMessage[],
  models: PalotModel[],
): ContextUsage | null {
  let message: PalotMessage | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.type !== "assistant" || tokenTotal(candidate) <= 0) continue;
    message = candidate;
    break;
  }
  if (!message) return null;

  const total = tokenTotal(message);
  const model = models.find(
    (candidate) =>
      candidate.id === message.model?.id && candidate.providerID === message.model.providerID,
  );
  const limit = model?.contextLimit ?? null;
  return {
    total,
    limit,
    percentage: limit ? Math.round((total / limit) * 100) : null,
  };
}
