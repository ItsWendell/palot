import type { PalotIntegration } from "../../shared";

export const POPULAR_PROVIDER_IDS = [
  "opencode",
  "opencode-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
] as const;

const popularProviderRank = new Map<string, number>(
  POPULAR_PROVIDER_IDS.map((id, index) => [id, index]),
);

export function isPopularProvider(id: string): boolean {
  return popularProviderRank.has(id);
}

export function orderProviderIntegrations(integrations: PalotIntegration[]) {
  return integrations.toSorted((left, right) => {
    const connectionOrder =
      Number(right.connections.length > 0) - Number(left.connections.length > 0);
    if (connectionOrder !== 0) return connectionOrder;
    return (
      (popularProviderRank.get(left.id) ?? Number.POSITIVE_INFINITY) -
        (popularProviderRank.get(right.id) ?? Number.POSITIVE_INFINITY) ||
      left.name.localeCompare(right.name)
    );
  });
}
