import type { PalotMessageContent } from "../../shared";

const CURRENCY = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});
const NUMBER = new Intl.NumberFormat(undefined);

export function CompactionUsage({ part }: { part: PalotMessageContent | undefined }) {
  if (part?.type !== "compaction" || (part.cost === undefined && !part.tokens)) return null;
  const usage = part.tokens;
  const details = [
    ...(part.cost !== undefined ? [CURRENCY.format(part.cost)] : []),
    ...(usage
      ? [
          `${NUMBER.format(usage.input)} input`,
          `${NUMBER.format(usage.output)} output`,
          `${NUMBER.format(usage.reasoning)} reasoning`,
          `${NUMBER.format(usage.cache.read)} cache read`,
          `${NUMBER.format(usage.cache.write)} cache write`,
        ]
      : []),
  ];

  return (
    <p className="m-0 mb-2 text-meta text-muted-foreground">
      Compaction request{usage ? " tokens" : ""}: {details.join(" · ")}
    </p>
  );
}
