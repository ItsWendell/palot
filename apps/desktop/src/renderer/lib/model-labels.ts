import type { PalotModel } from "../../shared";
import { modelPreferenceKey } from "./model-preferences";

export interface ModelLabel {
  /** The model's name without "(latest)", with an ID suffix when its provider has another model by that name. */
  name: string;
  /** Another provider offers a model under the same name, so the provider must be shown beside it. */
  providerAmbiguous: boolean;
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
  }));
  const byName = Map.groupBy(rows, (row) => row.name.toLowerCase());
  return new Map(
    rows.map((row) => {
      const peers = byName.get(row.name.toLowerCase()) ?? [];
      const siblings = [
        ...new Set(
          peers.filter((peer) => peer.providerID === row.providerID).map((peer) => peer.id),
        ),
      ];
      const suffix =
        siblings.length > 1 ? row.id.slice(sharedPrefix(siblings)).replace(/^[-_./:]+/, "") : "";
      return [
        row.key,
        {
          name: suffix ? `${row.name} (${suffix})` : row.name,
          providerAmbiguous: peers.some((peer) => peer.providerID !== row.providerID),
        },
      ];
    }),
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
