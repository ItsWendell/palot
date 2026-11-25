import { useQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import type { PalotModel, PalotProvider } from "../../shared";
import { formatLimitReset } from "../../shared/provider-limit";
import { requestGlobalCommandAtom } from "../atoms/command-requests";
import { runtimeAtom } from "../atoms/workspace";
import { toast } from "../components/ui/toast";
import { hasConsoleProvider, modelLimit, type ModelLimit } from "../lib/model-limits";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { supportsUsageLimits, usageLimitsRouteKnown } from "../lib/usage-limits";
import { usageLimitsQueryOptions } from "./use-usage-limits";

/**
 * What OpenCode Console leaves each paid model in `directory`, from the same cached read as the
 * Usage page. Nothing is read unless a provider comes through Console. Turn ends and limit
 * failures refresh it (`openCodeInvalidationKeys`); there is no poll.
 */
export function useModelLimits(directory: string, providers: readonly PalotProvider[]) {
  const runtime = useAtomValue(runtimeAtom);
  const enabled =
    hasConsoleProvider(providers) &&
    supportsUsageLimits(runtime?.version) &&
    canFetchOpenCode(runtime);
  const query = useQuery(
    usageLimitsQueryOptions(
      runtime?.connectionID ?? "disconnected",
      directory,
      enabled,
      usageLimitsRouteKnown(runtime?.version) === true,
    ),
  );
  const info = enabled && query.data && query.data !== "unavailable" ? query.data : null;
  const byID = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  return useCallback(
    (model: PalotModel): ModelLimit | null =>
      info ? modelLimit(info, model, byID.get(model.providerID)) : null,
    [byID, info],
  );
}

const ALERTS_KEY = "palot.model-limit-alerts";

/** True the first time `key` is claimed while its window lasts, across restarts. */
function claimAlert(key: string, until: number): boolean {
  let seen: Record<string, number> = {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ALERTS_KEY) ?? "{}");
    if (parsed && typeof parsed === "object") seen = parsed as Record<string, number>;
  } catch {
    // A corrupt record only means a warning may show again.
  }
  const now = Date.now();
  const kept = Object.fromEntries(
    Object.entries(seen).filter(([, at]) => typeof at === "number" && at > now),
  );
  if (key in kept) return false;
  kept[key] = until;
  try {
    window.localStorage.setItem(ALERTS_KEY, JSON.stringify(kept));
  } catch {
    // Storage full or unavailable: warn now, perhaps again later.
  }
  return true;
}

/**
 * Warns once per limit window when the selected model runs low (under 15% left) and once when
 * it reaches its limit, wherever the model is selected.
 */
export function useModelLimitAlerts({
  model,
  name,
  limit,
  onSwitchModel,
}: {
  model: PalotModel | null;
  name: string;
  limit: ModelLimit | null;
  onSwitchModel(): void;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const runCommand = useSetAtom(requestGlobalCommandAtom);
  const level = limit?.level ?? "plenty";
  const resetsAt = limit?.resetsAt ?? null;
  const key =
    model && level !== "plenty" && resetsAt !== null
      ? `${runtime?.connectionID ?? ""}:${model.providerID}/${model.id}:${level}:${resetsAt}`
      : null;
  const percentLeft = limit?.percentLeft ?? 100;
  useEffect(() => {
    if (key === null || resetsAt === null || resetsAt <= Date.now()) return;
    if (!claimAlert(key, resetsAt)) return;
    const resets = formatLimitReset(resetsAt);
    if (level === "reached") {
      toast.add({
        type: "error",
        title: `${name} limit reached`,
        description: `Resets ${resets}.`,
        actionProps: { children: "Switch model", onClick: onSwitchModel },
      });
      return;
    }
    toast.add({
      type: "warning",
      title: `Running low on ${name}`,
      description: `${Math.max(1, Math.floor(percentLeft))}% left · resets ${resets}.`,
      actionProps: {
        children: "View usage",
        onClick: () => runCommand("usage.open"),
      },
    });
    // Once per key: later renders of the same window must not warn again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
