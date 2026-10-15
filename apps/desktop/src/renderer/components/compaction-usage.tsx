import type { PalotMessageContent } from "../../shared";
import { formatTokenCount, formatTokenExact, formatUsd, sumTokens } from "../lib/context-usage";

/** What the compaction request itself cost; the resulting window shows after the next reply. */
export function CompactionUsage({ part }: { part: PalotMessageContent | undefined }) {
  if (part?.type !== "compaction" || (part.cost === undefined && !part.tokens)) return null;
  const usage = part.tokens;
  const summary = [
    ...(usage ? [`${formatTokenCount(sumTokens(usage))} tokens`] : []),
    ...(part.cost !== undefined ? [formatUsd(part.cost)] : []),
  ].join(" · ");
  const breakdown = usage
    ? [
        `${formatTokenExact(usage.input + usage.cache.write)} uncached input`,
        `${formatTokenExact(usage.cache.read)} cached input`,
        `${formatTokenExact(usage.output + usage.reasoning)} output`,
      ].join(" · ")
    : undefined;

  return (
    <p className="m-0 mb-2 text-meta text-muted-foreground" title={breakdown}>
      Summarizing used {summary}
    </p>
  );
}
