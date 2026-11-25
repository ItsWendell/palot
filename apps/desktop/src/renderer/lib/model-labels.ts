import type { PalotModel } from "../../shared";
import { iconNames, type IconName } from "../components/ui/provider-icons/types";
import { modelPreferenceKey } from "./model-preferences";

export interface ModelLabel {
  /** The model's name without "(latest)", with an ID suffix when its provider has another model by that name. */
  name: string;
  /** Another provider offers a model under the same name, so the provider must be shown beside it. */
  providerAmbiguous: boolean;
  /**
   * The name without its leading brand ("Opus 5.5" for "Claude Opus 5.5"), for the composer's
   * model pill; the full `name` wherever the shorter one would be unclear or collide.
   */
  short: string;
  /**
   * The model's maker as a provider-icon sprite name, from the brand its name or ID starts
   * with, else its provider's icon when the sprite has one; null otherwise (never a placeholder).
   */
  icon: IconName | null;
}

/**
 * Brands that lead model names, dropped from the pill's short name when the rest still names the
 * model. Matched case-insensitively before a space or a hyphen. An unknown vendor simply shows
 * its full name.
 */
export const MODEL_BRAND_TOKENS = [
  "Claude",
  "GPT",
  "Gemini",
  "Grok",
  "Llama",
  "Mistral",
  "DeepSeek",
  "Qwen",
] as const;

/** Each brand's maker in the provider-icon sprite (Meta's models use the Llama mark). */
const BRAND_ICONS: Record<Lowercase<(typeof MODEL_BRAND_TOKENS)[number]>, IconName> = {
  claude: "anthropic",
  gpt: "openai",
  gemini: "google",
  grok: "xai",
  llama: "llama",
  mistral: "mistral",
  deepseek: "deepseek",
  qwen: "alibaba",
};

const BRAND_NAME = new RegExp(`^(${MODEL_BRAND_TOKENS.join("|")})(?=[ -]|$)`, "i");
/** Raw IDs: "claude-sonnet-4-5", "qwen3-coder", or after a router's "anthropic/" prefix. */
const BRAND_ID = new RegExp(`^(${MODEL_BRAND_TOKENS.join("|")})(?=[-_.:\\d]|$)`, "i");
const SPRITE = new Set<string>(iconNames);

/** The maker's icon for a model: its brand first, then its provider's, else none. */
export function modelMakerIcon(
  model: Pick<PalotModel, "providerID" | "id" | "name">,
): IconName | null {
  const brand =
    BRAND_NAME.exec(model.name.trim())?.[1] ??
    BRAND_ID.exec(model.id.split("/").at(-1) ?? model.id)?.[1];
  if (brand) return BRAND_ICONS[brand.toLowerCase() as keyof typeof BRAND_ICONS];
  return SPRITE.has(model.providerID) ? (model.providerID as IconName) : null;
}

const BRAND_PREFIX = new RegExp(`^(${MODEL_BRAND_TOKENS.join("|")})[ -]+`, "i");

/** Tier and variant words: they rank a model, they don't name it. */
const GENERIC_WORDS = new Set([
  "pro",
  "flash",
  "mini",
  "nano",
  "lite",
  "max",
  "plus",
  "ultra",
  "turbo",
  "high",
  "low",
  "medium",
  "small",
  "large",
  "fast",
  "free",
  "preview",
  "latest",
  "beta",
  "exp",
  "experimental",
  "thinking",
  "reasoning",
  "instruct",
  "chat",
  "code",
  "coder",
  "vision",
]);

/**
 * The name without a leading brand, when what remains has a distinctive word (3+ letters, not a
 * tier word); version tokens ("V3", "4o", "5.2") are not. Raw IDs (no space) stay as they are.
 */
export function shortModelName(name: string): string {
  if (!/\s/.test(name)) return name;
  const brand = BRAND_PREFIX.exec(name);
  if (!brand) return name;
  const rest = name.slice(brand[0].length).trim();
  const distinctive = rest
    .split(/[\s\-_/()]+/)
    .some((word) => /^[a-z]{3,}$/i.test(word) && !GENERIC_WORDS.has(word.toLowerCase()));
  return distinctive ? rest : name;
}

/**
 * Names that tell the listed models apart, keyed by `modelPreferenceKey`. Adapted from OpenCode's composer
 * model labels (packages/app/src/composer/model-label.ts, #59735), without its Console provider rules.
 */
export function modelLabels(
  models: readonly Pick<PalotModel, "providerID" | "id" | "name">[],
): ReadonlyMap<string, ModelLabel> {
  const rows = models.map((model) => ({
    key: modelPreferenceKey(model),
    providerID: model.providerID,
    id: model.id,
    name: model.name.replace(/\(latest\)/i, "").trim() || model.id,
    icon: modelMakerIcon(model),
  }));
  const byName = Map.groupBy(rows, (row) => row.name.toLowerCase());
  const labelled = rows.map((row) => {
    const peers = byName.get(row.name.toLowerCase()) ?? [];
    const siblings = [
      ...new Set(peers.filter((peer) => peer.providerID === row.providerID).map((peer) => peer.id)),
    ];
    const suffix =
      siblings.length > 1 ? row.id.slice(sharedPrefix(siblings)).replace(/^[-_./:]+/, "") : "";
    const name = suffix ? `${row.name} (${suffix})` : row.name;
    return {
      key: row.key,
      name,
      providerAmbiguous: peers.some((peer) => peer.providerID !== row.providerID),
      short: shortModelName(name),
      icon: row.icon,
    };
  });
  // Two models whose short names would match keep their full names.
  const shortCounts = Map.groupBy(labelled, (label) => label.short.toLowerCase());
  return new Map(
    labelled.map(({ key, name, providerAmbiguous, short, icon }) => [
      key,
      {
        name,
        providerAmbiguous,
        short: (shortCounts.get(short.toLowerCase())?.length ?? 0) > 1 ? name : short,
        icon,
      },
    ]),
  );
}

/**
 * The part of the IDs they all share, cut back to a separator, so "v1" and "v2" share nothing while
 * "gemini-4-argon" and "gemini-4-argon-eap" share "gemini-4-argon".
 */
function sharedPrefix(ids: readonly string[]): number {
  const first = ids[0] ?? "";
  const separator = (char: string | undefined) => !!char && /[-_./:]/.test(char);
  const boundary = (n: number) =>
    n === 0 || ids.every((id) => n === id.length || separator(id[n]) || separator(id[n - 1]));
  const differs = [...first].findIndex((char, index) => ids.some((id) => id[index] !== char));
  const common = differs === -1 ? first.length : differs;
  for (let n = common; n > 0; n--) if (boundary(n)) return n;
  return 0;
}
