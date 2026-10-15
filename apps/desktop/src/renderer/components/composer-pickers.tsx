/** Composer model, reasoning, and agent pickers on the shared ComposerPicker. */

import type { ModelRef } from "@opencode/client";
import { useAtom } from "jotai";
import { Bot, Brain, Settings2, Star } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import type { PalotAgent, PalotModel, PalotProvider, PalotSession } from "../../shared";
import {
  activeReasoningVariant,
  baseModelCost,
  formatModalities,
  formatModelPrice,
  formatTokenLimit,
  groupPickerModels,
  newModelKeys,
  modelSearchValues,
  sentenceCase,
} from "../lib/model-picker";
import {
  modelPickerUsage,
  modelPickerUsageAtom,
  modelPreferenceKey,
  rememberRecentModel,
  toggleFavoriteModel,
} from "../lib/model-preferences";
import { modelMatchesRef, resolveModelSelection } from "../lib/model-selection";
import { primaryAgents } from "../lib/selection-memory";
import { Button } from "./ui/button";
import {
  ComposerPicker,
  type ComposerPickerBadge,
  type ComposerPickerOption,
  type ComposerPickerSection,
} from "./ui/composer-picker";

const STATUS_BADGES: Partial<Record<PalotModel["status"], ComposerPickerBadge>> = {
  alpha: { label: "Alpha", tone: "warning" },
  beta: { label: "Beta", tone: "neutral" },
  deprecated: { label: "Deprecated", tone: "danger" },
};

interface PickerMenuProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelectionComplete(): void;
  disabled: boolean;
}

export const ModelPicker = memo(function ModelPicker({
  session,
  models,
  catalogModels,
  defaultModel,
  providers,
  preferenceScope,
  open,
  onOpenChange,
  onSelectionComplete,
  onSelectModel,
  onManageModels,
  disabled,
  draft = false,
}: PickerMenuProps & {
  session: PalotSession;
  /** A new task shows its remembered model; an existing task shows its own. */
  draft?: boolean;
  /** Visible models in the person's order. */
  models: PalotModel[];
  catalogModels: PalotModel[];
  defaultModel: PalotModel | null;
  providers: PalotProvider[];
  preferenceScope: string;
  onSelectModel(model: ModelRef): Promise<void>;
  onManageModels(): void;
}) {
  const [usages, setUsages] = useAtom(modelPickerUsageAtom);
  const usage = modelPickerUsage(usages, preferenceScope);
  const selection = resolveModelSelection(catalogModels, session.model, defaultModel);
  const selectedRef = selection.ref;
  const selected = selection.model;
  const unavailable = session.model !== null && selected === null;
  const label = selected?.name ?? selectedRef?.id ?? "Choose model";
  const providerNames = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  );

  const sections = useMemo(() => {
    const groups = groupPickerModels(models, usage, providers);
    const favorites = new Set(usage.favorites);
    const fresh = newModelKeys(models);
    const option = (model: PalotModel, showProvider: boolean) => {
      const key = modelPreferenceKey(model);
      const providerName = providerNames.get(model.providerID) ?? model.providerID;
      const badges: ComposerPickerBadge[] = [];
      const status = STATUS_BADGES[model.status];
      if (status) badges.push(status);
      if (fresh.has(key)) badges.push({ label: "New", tone: "new" });
      if (modelMatchesRef(model, defaultModel)) badges.push({ label: "Default" });
      return {
        key,
        value: model,
        label: model.name,
        description: showProvider ? providerName : undefined,
        keywords: modelSearchValues(model, providerName),
        badges,
        meta: formatTokenLimit(model.contextLimit),
        favorite: favorites.has(key),
        attributes: { "data-palot-model-option": true },
      } satisfies ComposerPickerOption<PalotModel | null>;
    };
    const result: ComposerPickerSection<PalotModel | null>[] = [];
    if (unavailable && selectedRef) {
      result.push({
        key: "current",
        heading: draft ? "Last used" : "Current task",
        options: [
          {
            key: `unavailable:${selectedRef.providerID}/${selectedRef.id}`,
            value: null,
            label: selectedRef.id,
            keywords: [selectedRef.providerID],
            disabled: true,
            disabledReason: "No longer available",
          },
        ],
      });
    }
    if (groups.favorites.length > 0) {
      result.push({
        key: "favorites",
        heading: "Favorites",
        hideWhenSearching: true,
        options: groups.favorites.map((model) => option(model, true)),
      });
    }
    if (groups.recent.length > 0) {
      result.push({
        key: "recent",
        heading: "Recent",
        hideWhenSearching: true,
        options: groups.recent.map((model) => option(model, true)),
      });
    }
    for (const provider of groups.providers) {
      result.push({
        key: `provider:${provider.id}`,
        heading: provider.name,
        collapsible: groups.providers.length > 1,
        options: provider.models.map((model) => option(model, false)),
      });
    }
    return result;
  }, [defaultModel, draft, models, providerNames, providers, selectedRef, unavailable, usage]);

  const toggleFavorite = useCallback(
    (option: ComposerPickerOption<PalotModel | null>) => {
      if (!option.value) return;
      setUsages((current) => toggleFavoriteModel(current, preferenceScope, option.key));
    },
    [preferenceScope, setUsages],
  );

  const renderDetail = useCallback(
    (option: ComposerPickerOption<PalotModel | null> | null) =>
      option?.value ? (
        <ModelDetails
          model={option.value}
          providerName={providerNames.get(option.value.providerID) ?? option.value.providerID}
          favorite={option.favorite === true}
          onToggleFavorite={() => toggleFavorite(option)}
        />
      ) : null,
    [providerNames, toggleFavorite],
  );

  const actions = useMemo(
    () => [
      {
        key: "manage",
        label: "Manage models",
        icon: <Settings2 aria-hidden="true" />,
        onSelect: onManageModels,
      },
    ],
    [onManageModels],
  );

  return (
    <ComposerPicker<PalotModel | null>
      label={label}
      ariaLabel={`Model: ${label}${unavailable ? ", unavailable" : ""}`}
      secondary={unavailable ? "Unavailable" : selection.usesDefault ? "Default" : null}
      tone={unavailable ? "warning" : "default"}
      triggerClassName="palot-model-trigger max-w-64 shrink"
      labelAttributes={{ "data-palot-model-name": true }}
      secondaryAttributes={{ "data-palot-model-detail-label": true }}
      tooltip="Choose model"
      shortcuts={["composer.model"]}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      align="end"
      popupClassName="w-[min(36rem,calc(100vw-24px))]"
      title="Model"
      description={
        unavailable
          ? draft
            ? "The model you last used is unavailable right now. Choose another model to send."
            : "This task's selected model is no longer available. Choose another model to continue."
          : undefined
      }
      actionsPlacement="header"
      listLabel="Models"
      search={{ label: "Choose model", placeholder: "Search models…" }}
      sections={sections}
      selectedKey={selected ? modelPreferenceKey(selected) : null}
      emptyLabel={models.length === 0 ? "No models available." : "No models found."}
      renderDetail={renderDetail}
      actions={actions}
      errorTitle="Could not switch models"
      onSelect={async (option) => {
        const model = option.value;
        if (!model) return;
        await onSelectModel({ id: model.id, providerID: model.providerID });
        setUsages((current) => rememberRecentModel(current, preferenceScope, option.key));
      }}
      onSelectionComplete={onSelectionComplete}
      onToggleFavorite={toggleFavorite}
    />
  );
});

function ModelDetails({
  model,
  providerName,
  favorite,
  onToggleFavorite,
}: {
  model: PalotModel;
  providerName: string;
  favorite: boolean;
  onToggleFavorite(): void;
}) {
  const cost = baseModelCost(model);
  const tiered = (model.cost?.length ?? 0) > 1;
  return (
    <div className="grid gap-3" data-palot-model-details>
      <div className="grid gap-0.5">
        <p className="text-compact font-medium break-words">{model.name}</p>
        <p className="text-meta text-muted-foreground">{providerName}</p>
        <p className="truncate font-mono text-micro text-muted-foreground" title={model.id}>
          {model.id}
        </p>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-meta">
        <dt className="text-muted-foreground">Context</dt>
        <dd className="tabular-nums">{formatTokenLimit(model.contextLimit)} tokens</dd>
        <dt className="text-muted-foreground">Max output</dt>
        <dd className="tabular-nums">{formatTokenLimit(model.outputLimit)} tokens</dd>
        <dt className="text-muted-foreground">Input</dt>
        <dd>{formatModalities(model.capabilities.input)}</dd>
        <dt className="text-muted-foreground">Tools</dt>
        <dd>{model.capabilities.tools ? "Supported" : "Not supported"}</dd>
        {cost ? (
          <>
            <dt className="text-muted-foreground">Cost</dt>
            <dd className="tabular-nums">
              {formatModelPrice(cost.input)} in · {formatModelPrice(cost.output)} out
              <span className="block text-muted-foreground">
                per 1M tokens{tiered ? ", base tier" : ""}
              </span>
            </dd>
          </>
        ) : null}
        {model.variants.length > 0 ? (
          <>
            <dt className="text-muted-foreground">Reasoning</dt>
            <dd>{model.variants.map(sentenceCase).join(", ")}</dd>
          </>
        ) : null}
      </dl>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        aria-pressed={favorite}
        onClick={onToggleFavorite}
      >
        <Star className={favorite ? "fill-current text-warning" : undefined} aria-hidden="true" />
        {favorite ? "Remove from favorites" : "Add to favorites"}
      </Button>
    </div>
  );
}

export const ReasoningPicker = memo(function ReasoningPicker({
  session,
  catalogModels,
  defaultModel,
  open,
  onOpenChange,
  onSelectionComplete,
  onSelectVariant,
  disabled,
}: PickerMenuProps & {
  session: PalotSession;
  catalogModels: PalotModel[];
  defaultModel: PalotModel | null;
  onSelectVariant(model: ModelRef): Promise<void>;
}) {
  const selected = resolveModelSelection(catalogModels, session.model, defaultModel).model;
  const variants = selected?.variants;
  const sections = useMemo<ComposerPickerSection<string | undefined>[]>(
    () => [
      {
        key: "effort",
        options: [
          {
            key: "default",
            value: undefined,
            label: "Auto",
            description: "Use the model's default effort",
          },
          ...(variants ?? []).map((variant) => ({
            key: variant,
            value: variant,
            label: sentenceCase(variant),
            attributes: { "data-palot-model-variant": true },
          })),
        ],
      },
    ],
    [variants],
  );
  if (!selected || selected.variants.length === 0) return null;
  const active = activeReasoningVariant(selected.variants, session.model?.variant);
  const effort = active ? sentenceCase(active) : "Auto";

  return (
    <ComposerPicker<string | undefined>
      label={effort}
      ariaLabel={`Reasoning: ${effort}`}
      icon={<Brain className="shrink-0" aria-hidden="true" />}
      triggerClassName="max-w-36 shrink-0"
      labelAttributes={{ "data-palot-model-effort": true }}
      tooltip="Reasoning effort"
      shortcuts={["composer.reasoning.cycle"]}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      align="end"
      popupClassName="w-60"
      title="Reasoning effort"
      description={selected.name}
      listLabel="Reasoning effort"
      sections={sections}
      selectedKey={active ?? "default"}
      errorTitle="Could not change reasoning effort"
      onSelect={(option) =>
        onSelectVariant({
          id: selected.id,
          providerID: selected.providerID,
          ...(option.value ? { variant: option.value } : {}),
        })
      }
      onSelectionComplete={onSelectionComplete}
    />
  );
});

export const AgentPicker = memo(function AgentPicker({
  session,
  agents,
  defaultAgent,
  loading,
  open,
  onOpenChange,
  onSelectionComplete,
  onSelectAgent,
  disabled,
}: PickerMenuProps & {
  session: PalotSession;
  agents: PalotAgent[];
  defaultAgent: PalotAgent | null;
  loading: boolean;
  onSelectAgent(agent: PalotAgent): Promise<void>;
}) {
  const available = useMemo(() => primaryAgents(agents), [agents]);
  const selected = available.find((agent) => agent.id === session.agent) ?? null;
  // Without an explicit agent, OpenCode runs its default agent; show that agent by name.
  const label = selected?.name ?? session.agent ?? defaultAgent?.name ?? "Default";
  const implicitDefault = !session.agent && defaultAgent !== null;
  const sections = useMemo<ComposerPickerSection<PalotAgent>[]>(
    () => [
      {
        key: "agents",
        options: available.map((agent) => ({
          key: agent.id,
          value: agent,
          label: agent.name,
          description: agent.description ?? undefined,
          keywords: [agent.id],
        })),
      },
    ],
    [available],
  );

  return (
    <ComposerPicker<PalotAgent>
      label={label}
      ariaLabel={`Agent: ${label}${implicitDefault ? " (default)" : ""}`}
      icon={<Bot className="shrink-0" aria-hidden="true" />}
      triggerClassName="max-w-40 gap-1"
      tooltip="Switch agent"
      shortcuts={["composer.agent.next", "composer.agent.previous"]}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      popupClassName="w-[min(360px,calc(100vw-24px))]"
      title="Agent"
      description="Choose the primary agent used by this task."
      listLabel="Agents"
      search={{ label: "Choose agent", placeholder: "Search agents…" }}
      sections={sections}
      selectedKey={session.agent}
      loading={loading}
      loadingLabel="Loading agents…"
      emptyLabel="No primary agents found."
      errorTitle="Could not switch agents"
      onSelect={(option) => onSelectAgent(option.value)}
      onSelectionComplete={onSelectionComplete}
    />
  );
});
