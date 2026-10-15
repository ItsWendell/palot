import type {
  PalotAgent,
  PalotConfigSource,
  PalotIntegration,
  PalotModel,
  PalotProvider,
} from "../../../shared";
import { isPopularProvider, POPULAR_PROVIDER_IDS } from "../../lib/provider-presentation";

// ── Provider sources ─────────────────────────────────────────────────────────

/** Where a connected provider's access comes from, in the order OpenCode prefers them. */
export type ProviderSource =
  | "account"
  | "api-key"
  | "external"
  | "credential"
  | "env"
  | "config"
  | "integration";

export const PROVIDER_SOURCE_LABEL: Record<ProviderSource, string> = {
  account: "Account",
  "api-key": "API key",
  external: "External",
  credential: "Credential",
  env: "Env",
  config: "Config",
  integration: "Integration",
};

export const PROVIDER_SOURCE_DESCRIPTION: Record<ProviderSource, string> = {
  account: "Signed in with an account",
  "api-key": "Uses a stored API key",
  external: "Uses credentials managed outside OpenCode",
  credential: "Uses a stored credential",
  env: "Uses an environment variable",
  config: "Defined in OpenCode config",
  integration: "Enabled by an OpenCode plugin or integration",
};

/**
 * OpenCode lists the selected connection first: a stored credential when there is one,
 * otherwise an environment variable. A provider without connections that OpenCode still
 * makes available comes from config or a plugin.
 */
export function providerSource(
  integration: PalotIntegration | null,
  providerIDs: readonly string[],
  configuredProviderIDs: ReadonlySet<string>,
): ProviderSource {
  const active = integration?.connections[0];
  if (active?.type === "credential") {
    if (active.method === "oauth") return "account";
    if (active.method === "key") return "api-key";
    if (active.method === "external") return "external";
    return "credential";
  }
  if (active?.type === "env") return "env";
  const ids = [integration?.id, ...providerIDs].filter((id): id is string => Boolean(id));
  return ids.some((id) => configuredProviderIDs.has(id)) ? "config" : "integration";
}

export function configuredProviderIDs(sources: readonly PalotConfigSource[]): Set<string> {
  return new Set(sources.flatMap((source) => source.providerIDs ?? []));
}

/** Port of OpenCode's `Wildcard.match` for provider IDs. */
export function wildcardMatch(input: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "s").test(input);
}

export interface ProviderPolicyMatch {
  effect: "allow" | "deny";
  resource: string;
  /** The config document holding the deciding statement; `null` for path-less documents. */
  path: string | null;
}

/**
 * The `provider.use` statement that decides a provider, as OpenCode evaluates it:
 * documents in reverse load order so user-global config outranks project config, and the
 * last matching statement wins. Console organization policies are not readable here.
 */
export function providerPolicy(
  sources: readonly PalotConfigSource[],
  providerID: string,
): ProviderPolicyMatch | null {
  const statements = sources
    .toReversed()
    .flatMap((source) =>
      (source.providerPolicies ?? []).map((policy) => ({ ...policy, path: source.path })),
    );
  return statements.findLast((policy) => wildcardMatch(providerID, policy.resource)) ?? null;
}

// ── Provider cards ───────────────────────────────────────────────────────────

export interface ProviderEntry {
  id: string;
  name: string;
  integration: PalotIntegration | null;
  /** Providers OpenCode makes available through this entry. */
  providers: PalotProvider[];
  source: ProviderSource;
  /** A config `provider.use` deny statement, or an inactive provider record. */
  blocked: ProviderPolicyMatch | null;
  disabled: boolean;
}

export function providerIDsFor(integrationID: string, providers: readonly PalotProvider[]) {
  return providers.filter((provider) => (provider.integrationID ?? provider.id) === integrationID);
}

/**
 * Connected providers: integrations with a stored credential or environment variable,
 * plus providers OpenCode makes available without one (config or plugin defined).
 */
export function connectedProviderEntries({
  integrations,
  providers,
  configSources,
}: {
  integrations: readonly PalotIntegration[];
  providers: readonly PalotProvider[];
  configSources: readonly PalotConfigSource[];
}): ProviderEntry[] {
  const configured = configuredProviderIDs(configSources);
  const entries: ProviderEntry[] = [];
  const claimed = new Set<string>();
  for (const integration of integrations) {
    const owned = providerIDsFor(integration.id, providers);
    if (integration.connections.length === 0 && owned.length === 0) continue;
    for (const provider of owned) claimed.add(provider.id);
    const policy = providerPolicy(configSources, integration.id);
    entries.push({
      id: integration.id,
      name: integration.name,
      integration,
      providers: owned,
      source: providerSource(
        integration,
        owned.map((provider) => provider.id),
        configured,
      ),
      blocked: policy?.effect === "deny" ? policy : null,
      disabled: owned.length > 0 && owned.every((provider) => provider.disabled),
    });
  }
  const integrationIDs = new Set(integrations.map((integration) => integration.id));
  for (const provider of providers) {
    if (claimed.has(provider.id)) continue;
    if (provider.integrationID && integrationIDs.has(provider.integrationID)) continue;
    entries.push({
      id: provider.id,
      name: provider.name,
      integration: null,
      providers: [provider],
      source: providerSource(null, [provider.id], configured),
      blocked: null,
      disabled: provider.disabled,
    });
  }
  return entries.toSorted(
    (left, right) =>
      popularRank(left.id) - popularRank(right.id) || left.name.localeCompare(right.name),
  );
}

function popularRank(id: string): number {
  const index = (POPULAR_PROVIDER_IDS as readonly string[]).indexOf(id);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

export function envNames(integration: PalotIntegration): string[] {
  return integration.methods.flatMap((method) => (method.type === "env" ? method.names : []));
}

export function connectable(integration: PalotIntegration): boolean {
  return integration.methods.some((method) => method.type !== "env");
}

// ── Models ───────────────────────────────────────────────────────────────────

export const NEW_MODEL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type ModelFilter =
  | "shown"
  | "hidden"
  | "new"
  | "tools"
  | "vision"
  | "reasoning"
  | "deprecated";

export const MODEL_FILTERS: ReadonlyArray<{ id: ModelFilter; label: string }> = [
  { id: "shown", label: "Shown" },
  { id: "hidden", label: "Hidden" },
  { id: "new", label: "New" },
  { id: "tools", label: "Tools" },
  { id: "vision", label: "Vision" },
  { id: "reasoning", label: "Reasoning" },
  { id: "deprecated", label: "Deprecated" },
];

export function isNewModel(model: PalotModel, now: number): boolean {
  return (
    model.releasedAt > 0 && now - model.releasedAt <= NEW_MODEL_WINDOW_MS && model.releasedAt <= now
  );
}

export function acceptsAttachments(model: PalotModel): boolean {
  return model.capabilities.input.some((input) => input === "image" || input === "pdf");
}

export function matchesModelFilter(
  model: PalotModel,
  filter: ModelFilter,
  { hidden, now }: { hidden: boolean; now: number },
): boolean {
  switch (filter) {
    case "shown":
      return !hidden;
    case "hidden":
      return hidden;
    case "new":
      return isNewModel(model, now);
    case "tools":
      return model.capabilities.tools;
    case "vision":
      return acceptsAttachments(model);
    case "reasoning":
      return model.variants.length > 0;
    case "deprecated":
      return model.status === "deprecated";
  }
}

export function matchesModelQuery(model: PalotModel, providerName: string, query: string): boolean {
  if (!query) return true;
  return `${model.name} ${model.id} ${model.providerID} ${providerName} ${model.family ?? ""}`
    .toLowerCase()
    .includes(query);
}

export interface ModelGroup {
  providerID: string;
  name: string;
  iconID: string;
  integrationID: string;
  /** Every model of the provider, in picker order. */
  models: PalotModel[];
}

/** Groups models by provider (popular providers first), keeping picker order within each. */
export function groupModelsByProvider(
  orderedModels: readonly PalotModel[],
  providers: readonly PalotProvider[],
): ModelGroup[] {
  const byID = new Map(providers.map((provider) => [provider.id, provider]));
  const groups = new Map<string, ModelGroup>();
  for (const model of orderedModels) {
    let group = groups.get(model.providerID);
    if (!group) {
      const provider = byID.get(model.providerID);
      group = {
        providerID: model.providerID,
        name: provider?.name ?? model.providerID,
        iconID: provider?.canonicalID ?? model.canonicalProviderID ?? model.providerID,
        integrationID: provider?.integrationID ?? model.providerID,
        models: [],
      };
      groups.set(model.providerID, group);
    }
    group.models.push(model);
  }
  return [...groups.values()].toSorted((left, right) => {
    const leftPopular = isPopularProvider(left.providerID);
    const rightPopular = isPopularProvider(right.providerID);
    if (leftPopular !== rightPopular) return leftPopular ? -1 : 1;
    return (
      popularRank(left.providerID) - popularRank(right.providerID) ||
      left.name.localeCompare(right.name)
    );
  });
}

/**
 * Moves `key` to the first slot its provider holds in the global picker order. Keys of
 * other providers keep their places, so per-provider moves stay compatible with the
 * single persisted order.
 */
export function moveToProviderTop(order: readonly string[], key: string, providerID: string) {
  const prefix = `${providerID}/`;
  const first = order.findIndex((candidate) => candidate.startsWith(prefix));
  const from = order.indexOf(key);
  if (first < 0 || from <= first) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(first, 0, key);
  return next;
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatTokens(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatUSD(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: value > 0 && value < 1 ? 3 : 2,
  }).format(value);
}

/**
 * The base (untiered) price per million tokens, "Free" when both are zero, and a note
 * when a higher tier starts above some prompt size. `null` when OpenCode reports none.
 */
export function formatModelCost(model: PalotModel): { label: string; note: string | null } | null {
  const tiers = model.cost ?? [];
  if (tiers.length === 0) return null;
  const base = tiers.find((tier) => tier.contextOver === null) ?? tiers[0]!;
  const label =
    base.input === 0 && base.output === 0
      ? "Free"
      : `${formatUSD(base.input)} in · ${formatUSD(base.output)} out per M`;
  const thresholds = tiers
    .map((tier) => tier.contextOver)
    .filter((size): size is number => typeof size === "number" && size > 0);
  const note = thresholds.length
    ? `tiered above ${formatTokens(Math.min(...thresholds))} tokens`
    : null;
  return { label, note };
}

export function formatReleaseDate(releasedAt: number): string | null {
  if (releasedAt <= 0) return null;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(releasedAt);
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export interface ConfiguredDefaultModel {
  /** `provider/model` as written in config. */
  value: string;
  providerID: string;
  modelID: string;
  path: string | null;
}

/** The latest config document that sets `model` decides OpenCode's configured default. */
export function configuredDefaultModel(
  sources: readonly PalotConfigSource[],
): ConfiguredDefaultModel | null {
  const source = sources.findLast((candidate) => candidate.summary?.model);
  const value = source?.summary?.model;
  if (!source || !value) return null;
  const slash = value.indexOf("/");
  return {
    value,
    providerID: slash > 0 ? value.slice(0, slash) : "",
    modelID: slash > 0 ? value.slice(slash + 1) : value,
    path: source.path,
  };
}

export function agentModelOverrides(agents: readonly PalotAgent[]) {
  return agents.filter(
    (agent): agent is PalotAgent & { model: NonNullable<PalotAgent["model"]> } =>
      agent.model !== null && !agent.hidden,
  );
}
