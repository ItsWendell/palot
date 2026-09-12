import type { PalotMessage } from "../../shared";

export interface LikelyCacheBust {
  messageID: string;
  drop: number;
  previousRead: number;
  currentRead: number;
}

interface CacheBaseline {
  read: number;
  model: NonNullable<PalotMessage["model"]>;
}

export function likelyCacheBusts(messages: PalotMessage[]): LikelyCacheBust[] {
  const warnings: LikelyCacheBust[] = [];
  let baseline: CacheBaseline | null = null;

  for (const message of messages) {
    if (completedCompaction(message)) {
      baseline = null;
      continue;
    }
    if (message.type !== "assistant" || !message.model || !message.tokens) continue;
    const tokens = message.tokens;
    const total =
      tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
    if (total <= 0) continue;

    const previous = baseline;
    baseline = { read: tokens.cache.read, model: message.model };
    if (!previous || !sameModel(previous.model, message.model)) continue;

    const drop = previous.read - tokens.cache.read;
    if (drop <= 0 || expectedOpenAIBucketShift(message.model.providerID, drop)) continue;
    warnings.push({
      messageID: message.id,
      drop,
      previousRead: previous.read,
      currentRead: tokens.cache.read,
    });
  }

  return warnings;
}

function sameModel(
  left: NonNullable<PalotMessage["model"]>,
  right: NonNullable<PalotMessage["model"]>,
): boolean {
  return (
    left.providerID === right.providerID && left.id === right.id && left.variant === right.variant
  );
}

function expectedOpenAIBucketShift(providerID: string, drop: number): boolean {
  return providerID === "openai" && drop >= 1_024 && drop <= 2_048;
}

function completedCompaction(message: PalotMessage): boolean {
  return (
    message.type === "compaction" &&
    message.content.some((part) => part.type === "compaction" && part.status === "completed")
  );
}
