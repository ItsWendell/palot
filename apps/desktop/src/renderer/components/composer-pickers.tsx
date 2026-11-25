/** The composer row's agent picker and its model and effort popover. */

import type { ModelRef } from "@opencode/client";
import { useAtom } from "jotai";
import { Bot, Columns3, Settings2, Star, TriangleAlert } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState, type Ref } from "react";
import type { PalotAgent, PalotModel, PalotProvider, PalotSession } from "../../shared";
import { cn } from "../lib/cn";
import { useShortcutKeys } from "../lib/keyboard-shortcuts";
import { ShortcutKbd } from "./ui/kbd";
import {
  activeReasoningVariant,
  formatTokenLimit,
  groupPickerModels,
  newModelKeys,
  modelSearchValues,
  effortLabel,
} from "../lib/model-picker";
import {
  modelPickerUsage,
  modelPickerUsageAtom,
  modelPreferenceKey,
  rememberRecentModel,
  toggleFavoriteModel,
} from "../lib/model-preferences";
import { modelLabels } from "../lib/model-labels";
import { modelLimitDescription, modelLimitLabel } from "../lib/model-limits";
import { useModelLimitAlerts, useModelLimits } from "../hooks/use-model-limits";
import { modelMatchesRef, resolveModelSelection } from "../lib/model-selection";
import { primaryAgents } from "../lib/selection-memory";
import { Button } from "./ui/button";
import {
  ComposerPicker,
  useComposerPickerAction,
  type ComposerPickerBadge,
  type ComposerPickerOption,
  type ComposerPickerSection,
} from "./ui/composer-picker";
import { ProviderIcon } from "./ui/provider-icon";
import { Spinner } from "./ui/spinner";

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

const EFFORT_HINTS: Record<string, string> = {
  auto: "Model decides",
  minimal: "Fastest",
  low: "Quick",
  medium: "Balanced",
  high: "Thinks longer",
  xhigh: "Most thorough",
  max: "Most thorough",
};

/**
 * One popover for the model and its reasoning effort. The pill reads "model · effort". The
 * popover opens above it at a fixed size: search and the model list on the left, the
 * highlighted model's effort on the right, actions in the footer. Picking a model with effort
 * levels moves focus to them; Left goes back to the search.
 */
export const ModelPopover = memo(function ModelPopover({
  session,
  models,
  catalogModels,
  defaultModel,
  providers,
  preferenceScope,
  open,
  onOpenChange,
  finalFocus,
  onSelectionComplete,
  onSelectModel,
  onSelectVariant,
  onManageModels,
  onSendToModels,
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
  /** Where focus goes when the popover closes without a choice. */
  finalFocus?: () => HTMLElement | null;
  /** Switches to a model with the effort remembered for it. */
  onSelectModel(model: ModelRef): Promise<void>;
  /** Switches to exactly this model and effort. */
  onSelectVariant(model: ModelRef): Promise<void>;
  onManageModels(): void;
  /** Opens "Send to several models"; absent where it does not apply (an existing task). */
  onSendToModels?(): void;
}) {
  const [usages, setUsages] = useAtom(modelPickerUsageAtom);
  const usage = modelPickerUsage(usages, preferenceScope);
  const selection = resolveModelSelection(catalogModels, session.model, defaultModel);
  const selectedRef = selection.ref;
  const selected = selection.model;
  const unavailable = session.model !== null && selected === null;
  const activeVariant = selected
    ? activeReasoningVariant(selected.variants, session.model?.variant)
    : undefined;
  const effort =
    selected && selected.variants.length > 0
      ? activeVariant
        ? effortLabel(activeVariant)
        : "Auto"
      : null;
  const providerNames = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  );
  // Names that tell the listed models apart: the same name from two providers shows its provider.
  const labels = useMemo(
    () => modelLabels(selected && !models.includes(selected) ? [...models, selected] : models),
    [models, selected],
  );
  const selectedLabel = selected ? labels.get(modelPreferenceKey(selected)) : undefined;
  const providerPrefix =
    selected && selectedLabel?.providerAmbiguous
      ? `${providerNames.get(selected.providerID) ?? selected.providerID} / `
      : "";
  const label = selected
    ? `${providerPrefix}${selectedLabel?.name ?? selected.name}`
    : (selectedRef?.id ?? "Choose model");
  // The pill shows the short name ("Opus 5.5"); its name and tooltip keep the full one.
  const pillLabel = selected ? `${providerPrefix}${selectedLabel?.short ?? selected.name}` : label;
  const selectedKey = selected ? modelPreferenceKey(selected) : null;
  // What Console leaves each paid model, on its row; the selected model warns when it runs low.
  const limitFor = useModelLimits(session.location.directory, providers);
  useModelLimitAlerts({
    model: selected,
    name: label,
    limit: selected ? limitFor(selected) : null,
    onSwitchModel: () => onOpenChange(true),
  });

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
      const limit = limitFor(model);
      return {
        key,
        value: model,
        label: labels.get(key)?.name ?? model.name,
        description: showProvider ? providerName : undefined,
        keywords: modelSearchValues(model, providerName),
        icon: <ProviderIcon id={model.providerID} className="size-3.5 text-foreground/80" />,
        badges,
        meta: limit ? (
          <span
            className={cn(
              limit.level === "low" && "text-warning",
              limit.level === "reached" && "text-destructive",
            )}
            title={modelLimitDescription(limit)}
            data-palot-model-limit={limit.level}
          >
            {modelLimitLabel(limit)}
          </span>
        ) : (
          formatTokenLimit(model.contextLimit)
        ),
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
  }, [
    defaultModel,
    draft,
    labels,
    limitFor,
    models,
    providerNames,
    providers,
    selectedRef,
    unavailable,
    usage,
  ]);

  const toggleFavorite = useCallback(
    (option: ComposerPickerOption<PalotModel | null>) => {
      if (!option.value) return;
      setUsages((current) => toggleFavoriteModel(current, preferenceScope, option.key));
    },
    [preferenceScope, setUsages],
  );

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const effortRef = useRef<HTMLDivElement>(null);
  const [pendingEffort, setPendingEffort] = useState<string | null>(null);
  const effortAction = useComposerPickerAction({
    errorTitle: "Could not change reasoning effort",
    onSuccess: () => {
      close();
      onSelectionComplete();
    },
  });

  const chooseEffort = useCallback(
    (model: PalotModel, variant: string | undefined) => {
      const key = modelPreferenceKey(model);
      if (key === selectedKey && variant === activeVariant) {
        close();
        onSelectionComplete();
        return;
      }
      setPendingEffort(variant ?? "auto");
      void effortAction
        .run(async () => {
          await onSelectVariant({
            id: model.id,
            providerID: model.providerID,
            ...(variant ? { variant } : {}),
          });
          if (key !== selectedKey)
            setUsages((current) => rememberRecentModel(current, preferenceScope, key));
        })
        .finally(() => setPendingEffort(null));
    },
    [
      activeVariant,
      close,
      effortAction,
      onSelectVariant,
      onSelectionComplete,
      preferenceScope,
      selectedKey,
      setUsages,
    ],
  );

  const renderDetail = useCallback(
    (option: ComposerPickerOption<PalotModel | null> | null) => (
      <EffortColumn
        key={option?.key ?? "none"}
        ref={effortRef}
        model={option?.value ?? null}
        name={option?.label ?? null}
        current={option?.key === selectedKey}
        activeVariant={option?.key === selectedKey ? activeVariant : undefined}
        favorite={option?.favorite === true}
        pending={effortAction.busy ? pendingEffort : null}
        disabled={disabled}
        onToggleFavorite={() => option && toggleFavorite(option)}
        onChoose={chooseEffort}
      />
    ),
    [
      activeVariant,
      chooseEffort,
      disabled,
      effortAction.busy,
      pendingEffort,
      selectedKey,
      toggleFavorite,
    ],
  );

  const actions = useMemo(
    () => [
      ...(onSendToModels
        ? [
            {
              key: "send-to-models",
              label: "Send to several models…",
              icon: <Columns3 aria-hidden="true" />,
              onSelect: onSendToModels,
            },
          ]
        : []),
      {
        key: "manage",
        label: "Manage models",
        icon: <Settings2 aria-hidden="true" />,
        onSelect: onManageModels,
      },
    ],
    [onManageModels, onSendToModels],
  );

  return (
    <ComposerPicker<PalotModel | null>
      size="pill"
      label={pillLabel}
      secondary={effort}
      ariaLabel={`Model: ${label}${effort ? `, effort ${effort}` : ""}${unavailable ? ", unavailable" : ""}`}
      icon={
        unavailable ? (
          <TriangleAlert className="shrink-0" aria-hidden="true" />
        ) : selectedLabel?.icon ? (
          // The maker, which the short name leaves out; the list keeps the provider's icon.
          <ProviderIcon
            id={selectedLabel.icon}
            data-palot-model-icon={selectedLabel.icon}
            className="size-3.5 shrink-0 text-foreground/80"
          />
        ) : undefined
      }
      tone={unavailable ? "warning" : "default"}
      triggerClassName="palot-model-trigger max-w-72"
      labelAttributes={{ "data-palot-model-name": true }}
      secondaryAttributes={{ "data-palot-model-effort": true }}
      tooltip={pillLabel === label ? "Model and effort" : `${label} · Model and effort`}
      shortcuts={["composer.model"]}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      finalFocus={finalFocus ? () => finalFocus() ?? true : undefined}
      align="end"
      popupClassName="h-[min(23rem,var(--available-height))] w-[min(34rem,calc(100vw-24px))]"
      description={
        unavailable
          ? draft
            ? "The model you last used is unavailable right now. Choose another model to send."
            : "This task's selected model is no longer available. Choose another model to continue."
          : undefined
      }
      listLabel="Models"
      search={{ label: "Choose model", placeholder: "Search models…" }}
      sections={sections}
      selectedKey={selectedKey}
      emptyLabel={models.length === 0 ? "No models available." : "No models found."}
      renderDetail={renderDetail}
      detailPlacement="column"
      actions={actions}
      errorTitle="Could not switch models"
      onSelect={async (option) => {
        const model = option.value;
        if (!model) return;
        await onSelectModel({ id: model.id, providerID: model.providerID });
        setUsages((current) => rememberRecentModel(current, preferenceScope, option.key));
      }}
      afterSelect={(option) => {
        if (!option.value?.variants.length) return;
        // Go on to the effort, on the one now in effect.
        requestAnimationFrame(() =>
          effortRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus(),
        );
        return false;
      }}
      onSelectionComplete={onSelectionComplete}
      onToggleFavorite={toggleFavorite}
    />
  );
});

/**
 * The highlighted model's effort levels ("Auto" first), with its favourite toggle. A list with
 * one tab stop: Up and Down move, Enter or Space picks, Left returns to the search.
 */
function EffortColumn({
  ref,
  model,
  name,
  current,
  activeVariant,
  favorite,
  pending,
  disabled,
  onToggleFavorite,
  onChoose,
}: {
  ref: Ref<HTMLDivElement>;
  model: PalotModel | null;
  name: string | null;
  current: boolean;
  activeVariant: string | undefined;
  favorite: boolean;
  /** The effort being applied ("auto" for Auto). */
  pending: string | null;
  disabled: boolean;
  onToggleFavorite(): void;
  onChoose(model: PalotModel, variant: string | undefined): void;
}) {
  const choices = model?.variants.length ? [undefined, ...model.variants] : [];
  const checkedIndex = current ? choices.indexOf(activeVariant) : -1;
  const [focusIndex, setFocusIndex] = useState(Math.max(0, checkedIndex));

  const move = (list: HTMLElement, index: number) => {
    const next = (index + choices.length) % choices.length;
    setFocusIndex(next);
    list.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
  };

  return (
    <>
      <div className="flex min-h-7 items-center gap-1 ps-2">
        <p className="m-0 min-w-0 flex-1 truncate text-meta font-medium text-muted-foreground">
          {name ? `Effort · ${name}` : "Effort"}
        </p>
        {model ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-pressed={favorite}
            aria-label={favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onToggleFavorite}
          >
            <Star
              className={cn("size-3", favorite && "fill-current text-warning")}
              aria-hidden="true"
            />
          </Button>
        ) : null}
      </div>
      {!model ? (
        <p className="m-0 px-2 py-1 text-meta leading-snug text-muted-foreground">
          {name ? "No longer available." : null}
        </p>
      ) : choices.length === 0 ? (
        <p className="m-0 px-2 py-1 text-meta leading-snug text-muted-foreground">
          This model has no effort levels.
        </p>
      ) : (
        <div
          ref={ref}
          role="listbox"
          aria-label={`Effort for ${name}`}
          aria-disabled={disabled || undefined}
          className="flex flex-col"
          onKeyDown={(event) => {
            const list = event.currentTarget;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              move(list, focusIndex + (event.key === "ArrowDown" ? 1 : -1));
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              move(list, event.key === "Home" ? 0 : choices.length - 1);
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              list
                .closest('[data-slot="composer-picker"]')
                ?.querySelector<HTMLElement>("input")
                ?.focus();
            } else if ((event.key === "Enter" || event.key === " ") && !disabled) {
              event.preventDefault();
              onChoose(model, choices[focusIndex]);
            }
          }}
        >
          {choices.map((variant, index) => {
            const checked = index === checkedIndex;
            const key = variant ?? "auto";
            return (
              <div
                key={key}
                role="option"
                aria-selected={checked}
                tabIndex={index === focusIndex ? 0 : -1}
                data-palot-model-variant={variant ? "" : undefined}
                className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-compact outline-none select-none hover:bg-(--control-hover) focus-visible:ring-2 focus-visible:ring-ring/30"
                onFocus={() => setFocusIndex(index)}
                onClick={() => {
                  if (!disabled) onChoose(model, variant);
                }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-full border border-foreground/30",
                    checked && "border-foreground",
                  )}
                >
                  {pending === key ? (
                    <Spinner className="size-2.5" role={undefined} />
                  ) : checked ? (
                    <span className="size-1.5 rounded-full bg-foreground" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {variant ? effortLabel(variant) : "Auto"}
                </span>
                {EFFORT_HINTS[key] ? (
                  <span className="truncate text-meta text-muted-foreground">
                    {EFFORT_HINTS[key]}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

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
  const nextKeys = useShortcutKeys("composer.agent.next");
  const previousKeys = useShortcutKeys("composer.agent.previous");
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
      size="pill"
      compact="icon"
      icon={<Bot className="shrink-0" aria-hidden="true" />}
      triggerClassName="max-w-40"
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
      footer={
        nextKeys.length > 0 || previousKeys.length > 0 ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-palot-agent-shortcuts>
            {nextKeys.length > 0 ? (
              <span className="flex items-center gap-1.5">
                Next agent <ShortcutKbd keys={nextKeys} />
              </span>
            ) : null}
            {previousKeys.length > 0 ? (
              <span className="flex items-center gap-1.5">
                Previous <ShortcutKbd keys={previousKeys} />
              </span>
            ) : null}
          </span>
        ) : undefined
      }
      errorTitle="Could not switch agents"
      onSelect={(option) => onSelectAgent(option.value)}
      onSelectionComplete={onSelectionComplete}
    />
  );
});
