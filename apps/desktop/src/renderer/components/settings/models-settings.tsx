import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ModelRef } from "@opencode/client";
import { ArrowRight, ArrowUpToLine, Bot, GripVertical, Search, Sparkles } from "lucide-react";
import { useAtom } from "jotai";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PalotModel, PalotProject, PalotSettingsSnapshot } from "../../../shared";
import { defaultModelsAtom, modelPickerPreferencesAtom } from "../../atoms/ui";
import { useSettingsOwner } from "../../hooks/use-settings-owner";
import { cn } from "../../lib/cn";
import {
  applyModelPreference,
  modelPreferenceKey,
  modelProjectPreferenceKey,
  reconcileModelOrder,
  reconcileModelPreference,
  type ModelPickerPreference,
} from "../../lib/model-preferences";
import {
  SettingsEmpty,
  SettingsFacts,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
} from "../settings-layout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CopyField } from "../ui/copy-field";
import { Input } from "../ui/input";
import { ProviderIcon } from "../ui/provider-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Toggle } from "../ui/toggle";
import {
  MODEL_FILTERS,
  agentModelOverrides,
  configuredDefaultModel,
  formatModelCost,
  formatReleaseDate,
  formatTokens,
  groupModelsByProvider,
  isNewModel,
  matchesModelFilter,
  matchesModelQuery,
  moveToProviderTop,
  type ModelFilter,
  type ModelGroup,
} from "./provider-model-data";
import { useModelProviderLinks, useModelsProviderParam } from "./settings-links";

const STATUS_LABEL: Record<Exclude<PalotModel["status"], "active">, string> = {
  alpha: "Alpha",
  beta: "Beta",
  deprecated: "Deprecated",
};

const OPENCODE_DEFAULT = "opencode-default";

/**
 * Models: which model new tasks start with (OpenCode's configured default and Palot's
 * per-project override), then every model grouped by provider with Palot's picker
 * visibility and order. `focusProvider` (or the `provider` route parameter) expands and
 * scrolls to one provider.
 */
export function ModelSettings({
  project,
  snapshot,
  focusProvider,
}: {
  project: PalotProject;
  snapshot: PalotSettingsSnapshot | null;
  focusProvider?: string;
}) {
  const routeProvider = useModelsProviderParam();
  const target = focusProvider ?? routeProvider;
  const links = useModelProviderLinks(project.id);
  const [defaults, setDefaults] = useAtom(defaultModelsAtom);
  const owner = useSettingsOwner();
  const preferenceScope = modelProjectPreferenceKey(owner?.profileID ?? "disconnected", project.id);
  const [preferences, setPreferences] = useAtom(modelPickerPreferencesAtom);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ReadonlySet<ModelFilter>>(() => new Set());
  const [now] = useState(() => Date.now());
  const selected = defaults[preferenceScope] ?? null;
  const models = snapshot?.catalog.models ?? [];
  const preference = reconcileModelPreference(models, preferences[preferenceScope]);
  const orderedModels = applyModelPreference(models, preference, true);
  const hidden = new Set(preference.hidden);
  const groups = groupModelsByProvider(orderedModels, snapshot?.catalog.providers ?? []);
  const providerNames = new Map(groups.map((group) => [group.providerID, group.name]));
  const shownCount = orderedModels.filter((model) => !hidden.has(modelPreferenceKey(model))).length;
  const normalizedQuery = query.trim().toLowerCase();
  const filtering = Boolean(normalizedQuery) || filters.size > 0;
  const listedGroups = groups
    .map((group) => ({
      ...group,
      listed: group.models.filter(
        (model) =>
          matchesModelQuery(model, group.name, normalizedQuery) &&
          [...filters].every((filter) =>
            matchesModelFilter(model, filter, {
              hidden: hidden.has(modelPreferenceKey(model)),
              now,
            }),
          ),
      ),
    }))
    .filter((group) => !filtering || group.listed.length > 0);
  const listedModels = listedGroups.flatMap((group) => group.listed);

  const targets = (group: ModelGroup) =>
    Boolean(target) && (group.providerID === target || group.integrationID === target);
  const [expandState, setExpandState] = useState<{
    target: string | undefined;
    value: string[] | null;
  }>({ target, value: null });
  if (expandState.target !== target) setExpandState({ target, value: null });
  const defaultExpanded = target
    ? groups.filter(targets).map((group) => group.providerID)
    : groups.map((group) => group.providerID);
  const expanded = filtering
    ? listedGroups.map((group) => group.providerID)
    : (expandState.value ?? defaultExpanded);

  const sections = useRef(new Map<string, HTMLElement>());
  const revealed = useRef<string | null>(null);
  const firstTarget = groups.find(targets)?.providerID;
  useEffect(() => {
    if (!target || !firstTarget || revealed.current === target) return;
    const section = sections.current.get(firstTarget);
    if (!section) return;
    revealed.current = target;
    const frame = requestAnimationFrame(() => {
      section.scrollIntoView?.({ block: "start" });
      section
        .querySelector<HTMLElement>('[data-slot="accordion-trigger"]')
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [target, firstTarget]);

  function updatePreference(next: ModelPickerPreference) {
    setPreferences((current) => ({ ...current, [preferenceScope]: next }));
  }

  function setShown(targetModels: readonly PalotModel[], shown: boolean) {
    const nextHidden = new Set(preference.hidden);
    for (const model of targetModels) {
      const key = modelPreferenceKey(model);
      if (shown) nextHidden.delete(key);
      else nextHidden.add(key);
    }
    if (!shown) {
      const resolved = snapshot?.catalog.defaultModel ?? null;
      const hidesSelected = Boolean(
        selected && targetModels.some((model) => sameModel(model, selected)),
      );
      const hidesOpenCodeDefault = Boolean(
        !selected && resolved && targetModels.some((model) => sameModel(model, resolved)),
      );
      if (hidesSelected || hidesOpenCodeDefault) {
        const fallback = orderedModels.find(
          (candidate) => !nextHidden.has(modelPreferenceKey(candidate)),
        );
        setDefaults((current) => {
          if (fallback) return { ...current, [preferenceScope]: modelRef(fallback) };
          const next = { ...current };
          delete next[preferenceScope];
          return next;
        });
      }
    }
    updatePreference({ hidden: [...nextHidden], order: reconcileModelOrder(models, preference) });
  }

  function moveToTop(model: PalotModel) {
    const order = reconcileModelOrder(models, preference);
    updatePreference({
      hidden: preference.hidden,
      order: moveToProviderTop(order, modelPreferenceKey(model), model.providerID),
    });
  }

  function reorder(activeKey: string, overKey: string) {
    const order = reconcileModelOrder(models, preference);
    const from = order.indexOf(activeKey);
    const to = order.indexOf(overKey);
    if (from < 0 || to < 0 || from === to) return;
    updatePreference({ hidden: preference.hidden, order: arrayMove(order, from, to) });
  }

  function toggleFilter(filter: ModelFilter, pressed: boolean) {
    setFilters((current) => {
      const next = new Set(current);
      if (pressed) {
        next.add(filter);
        // Shown and Hidden exclude each other.
        if (filter === "shown") next.delete("hidden");
        if (filter === "hidden") next.delete("shown");
      } else next.delete(filter);
      return next;
    });
  }

  const catalogError = snapshot?.errors.find(
    (error) => error.capability === "catalog" || error.capability === "models",
  );

  return (
    <>
      <ModelDefaults
        snapshot={snapshot}
        models={orderedModels}
        hidden={hidden}
        providerNames={providerNames}
        selected={selected}
        onSelectedChange={(next) =>
          setDefaults((current) => {
            const updated = { ...current };
            if (next) updated[preferenceScope] = next;
            else delete updated[preferenceScope];
            return updated;
          })
        }
      />
      <SettingsSection
        title="Models in pickers"
        description={`${shownCount} of ${models.length} models are shown in Palot's model pickers. Hidden models stay available in OpenCode. Drag within a provider to set picker order.`}
        icon={Bot}
        action={
          links.available ? (
            <Button type="button" variant="outline" size="sm" onClick={() => links.openProviders()}>
              Manage providers
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 @lg/settings:flex-row @lg/settings:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                placeholder="Search models or providers"
                aria-label="Search models"
                className="h-8 pl-8"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1 self-end @lg/settings:self-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={filtering ? "Show all listed models" : "Show all models"}
                disabled={listedModels.every((model) => !hidden.has(modelPreferenceKey(model)))}
                onClick={() => setShown(listedModels, true)}
              >
                Show all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={filtering ? "Hide all listed models" : "Hide all models"}
                disabled={listedModels.every((model) => hidden.has(modelPreferenceKey(model)))}
                onClick={() => setShown(listedModels, false)}
              >
                Hide all
              </Button>
            </div>
          </div>
          <div role="group" aria-label="Filter models" className="flex flex-wrap gap-1.5">
            {MODEL_FILTERS.map((filter) => (
              <Toggle
                key={filter.id}
                variant="outline"
                size="sm"
                pressed={filters.has(filter.id)}
                onPressedChange={(pressed) => toggleFilter(filter.id, pressed)}
              >
                {filter.label}
              </Toggle>
            ))}
          </div>
          {catalogError ? (
            <SettingsNotice
              status="error"
              title={models.length ? "Could not refresh models" : "Could not load models"}
            >
              {catalogError.message}
            </SettingsNotice>
          ) : null}
          {listedGroups.length > 0 ? (
            <Accordion
              multiple
              value={expanded}
              onValueChange={(next) => {
                if (!filtering) setExpandState({ target, value: next as string[] });
              }}
              className="rounded-xl border-border bg-card"
            >
              {listedGroups.map((group) => (
                <ProviderModelGroup
                  key={group.providerID}
                  group={group}
                  listed={group.listed}
                  hidden={hidden}
                  sortable={!filtering}
                  now={now}
                  sectionRef={(element) => {
                    if (element) sections.current.set(group.providerID, element);
                    else sections.current.delete(group.providerID);
                  }}
                  onShownChange={setShown}
                  onMoveToTop={moveToTop}
                  onReorder={reorder}
                />
              ))}
            </Accordion>
          ) : (
            <SettingsGroup>
              <SettingsEmpty>
                {!snapshot
                  ? "Models are unavailable. Refresh settings when OpenCode is connected."
                  : models.length === 0
                    ? "OpenCode returned no models for this project. Connect a provider to add models."
                    : "No models match this search and these filters."}
              </SettingsEmpty>
            </SettingsGroup>
          )}
          {filtering && listedGroups.length > 0 ? (
            <p className="text-meta text-muted-foreground">Clear search and filters to reorder.</p>
          ) : null}
        </div>
      </SettingsSection>
    </>
  );
}

function ModelDefaults({
  snapshot,
  models,
  hidden,
  providerNames,
  selected,
  onSelectedChange,
}: {
  snapshot: PalotSettingsSnapshot | null;
  models: PalotModel[];
  hidden: ReadonlySet<string>;
  providerNames: ReadonlyMap<string, string>;
  selected: ModelRef | null;
  onSelectedChange(next: ModelRef | null): void;
}) {
  const configured = configuredDefaultModel(snapshot?.configSources ?? []);
  const resolved = snapshot?.catalog.defaultModel ?? null;
  const selectedModel = selected
    ? (models.find((model) => sameModel(model, selected)) ?? null)
    : null;
  const label = (model: Pick<PalotModel, "providerID" | "name">) =>
    `${providerNames.get(model.providerID) ?? model.providerID} · ${model.name}`;
  const selectedLabel = selected
    ? selectedModel
      ? label(selectedModel)
      : `${selected.providerID}/${selected.id}`
    : null;
  const resolvedLabel = resolved ? label(resolved) : null;
  const configuredUnavailable = Boolean(
    configured &&
    resolved &&
    (configured.providerID !== resolved.providerID || configured.modelID !== resolved.id),
  );
  const agents = agentModelOverrides(snapshot?.agents ?? []);
  const pickable = models.filter(
    (model) => !hidden.has(modelPreferenceKey(model)) || (selected && sameModel(model, selected)),
  );

  return (
    <SettingsSection
      title="Defaults"
      description="The model a new task starts with. Palot's project override wins over OpenCode's default."
      icon={Sparkles}
    >
      <SettingsGroup>
        <SettingsRow
          title="OpenCode default"
          badge={
            <Badge variant="neutral" size="sm">
              {configured ? "Set in config" : "Automatic"}
            </Badge>
          }
          description={
            configured
              ? `OpenCode config sets model to ${configured.value}. Change it in that file; Palot can't edit it.`
              : "Not set in OpenCode config, so OpenCode picks a model from your connected providers."
          }
          status={
            resolvedLabel
              ? `OpenCode resolves ${resolvedLabel}.`
              : snapshot
                ? "OpenCode has no default model for this project."
                : undefined
          }
        >
          {configured?.path || configuredUnavailable ? (
            <div className="flex flex-col gap-3">
              {configured?.path ? (
                <CopyField label="Config file" value={configured.path} className="max-w-xl" />
              ) : null}
              {configuredUnavailable ? (
                <SettingsNotice status="warning" variant="inline">
                  OpenCode can't use {configured!.value} here, so it resolves {resolvedLabel}{" "}
                  instead.
                </SettingsNotice>
              ) : null}
            </div>
          ) : null}
        </SettingsRow>
        <SettingsRow
          title="Palot override for this project"
          badge={
            <Badge variant={selected ? "info" : "neutral"} size="sm">
              {selected ? "On" : "Off"}
            </Badge>
          }
          description={
            selectedLabel
              ? `Palot uses ${selectedLabel} for new tasks in this project${resolvedLabel ? `; OpenCode's own default is ${resolvedLabel}` : ""}.`
              : `New tasks in this project use OpenCode's default${resolvedLabel ? ` (${resolvedLabel})` : ""}. Palot stores this choice on this computer only.`
          }
          control={
            <Select
              value={selected ? `${selected.providerID}/${selected.id}` : OPENCODE_DEFAULT}
              onValueChange={(value) => {
                const key = String(value);
                if (key === OPENCODE_DEFAULT) return onSelectedChange(null);
                const model = models.find((item) => modelPreferenceKey(item) === key);
                if (model) onSelectedChange(modelRef(model));
              }}
            >
              <SelectTrigger className="w-full @lg/settings:w-64" aria-label="Default model">
                <SelectValue>{selectedLabel ?? "Use OpenCode default"}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end" className="max-h-80">
                <SelectItem value={OPENCODE_DEFAULT}>Use OpenCode default</SelectItem>
                {pickable.map((model) => (
                  <SelectItem key={modelPreferenceKey(model)} value={modelPreferenceKey(model)}>
                    {label(model)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {selectedModel && selectedModel.variants.length > 0 ? (
          <SettingsRow
            title="Default effort"
            description="The reasoning effort Palot applies with this model when it creates a task."
            control={
              <Select
                value={selected?.variant ?? "model-default"}
                onValueChange={(value) => {
                  const variant = String(value);
                  onSelectedChange(
                    modelRef(selectedModel, variant === "model-default" ? undefined : variant),
                  );
                }}
              >
                <SelectTrigger className="w-full @lg/settings:w-64" aria-label="Default effort">
                  <SelectValue>
                    {selected?.variant ? sentenceCase(selected.variant) : "Model default"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="model-default">Model default</SelectItem>
                  {selectedModel.variants.map((variant) => (
                    <SelectItem key={variant} value={variant}>
                      {sentenceCase(variant)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        ) : null}
        {agents.length > 0 ? (
          <SettingsRow
            title="Agent models"
            description="These agents name their own model in OpenCode config. Change them in the agent's definition."
            align="start"
          >
            <SettingsFacts
              facts={agents.map((agent) => {
                const model = models.find((candidate) => sameModel(candidate, agent.model));
                return {
                  label: agent.name,
                  value: model
                    ? `${label(model)}${agent.model.variant ? ` · ${sentenceCase(agent.model.variant)}` : ""}`
                    : `${agent.model.providerID}/${agent.model.id}`,
                };
              })}
            />
          </SettingsRow>
        ) : null}
      </SettingsGroup>
    </SettingsSection>
  );
}

function ProviderModelGroup({
  group,
  listed,
  hidden,
  sortable,
  now,
  sectionRef,
  onShownChange,
  onMoveToTop,
  onReorder,
}: {
  group: ModelGroup;
  listed: PalotModel[];
  hidden: ReadonlySet<string>;
  sortable: boolean;
  now: number;
  sectionRef(element: HTMLElement | null): void;
  onShownChange(models: readonly PalotModel[], shown: boolean): void;
  onMoveToTop(model: PalotModel): void;
  onReorder(activeKey: string, overKey: string): void;
}) {
  const shown = group.models.filter((model) => !hidden.has(modelPreferenceKey(model))).length;
  const total = group.models.length;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const activeModel = activeKey
    ? (group.models.find((model) => modelPreferenceKey(model) === activeKey) ?? null)
    : null;
  const name = (id: unknown) =>
    group.models.find((model) => modelPreferenceKey(model) === id)?.name ?? "Model";
  const position = (id: unknown) =>
    listed.findIndex((model) => modelPreferenceKey(model) === id) + 1;

  function finish(event: DragEndEvent) {
    setActiveKey(null);
    if (event.over && event.active.id !== event.over.id)
      onReorder(String(event.active.id), String(event.over.id));
  }

  return (
    <AccordionItem
      value={group.providerID}
      ref={sectionRef}
      id={`models-provider-${group.providerID}`}
      aria-label={`${group.name} models`}
      className="scroll-mt-4 data-open:bg-transparent"
      render={<section />}
    >
      <div className="flex min-w-0 items-center gap-3 pr-4">
        <AccordionTrigger className="min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:no-underline">
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted/55 text-foreground">
              <ProviderIcon id={group.iconID} className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{group.name}</span>
              <span className="block text-meta font-normal text-muted-foreground">
                {shown} of {total} shown
              </span>
            </span>
          </span>
        </AccordionTrigger>
        <Switch
          checked={shown === total}
          aria-label={`Show all ${group.name} models`}
          onCheckedChange={(checked) => onShownChange(group.models, Boolean(checked))}
        />
      </div>
      <AccordionContent panelClassName="px-0" className="border-t border-border pb-0">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "Press space to pick up a model. Use the arrow keys to move it within its provider, space to drop it, or escape to cancel.",
            },
            announcements: {
              onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
              onDragOver: ({ active, over }) =>
                over
                  ? `${name(active.id)} is over position ${position(over.id)} of ${listed.length}.`
                  : undefined,
              onDragEnd: ({ active, over }) =>
                over
                  ? `${name(active.id)} was dropped at position ${position(over.id)} of ${listed.length}.`
                  : "Model was not moved.",
              onDragCancel: ({ active }) =>
                `Sorting cancelled. ${name(active.id)} returned to its original position.`,
            },
          }}
          onDragStart={(event) => setActiveKey(String(event.active.id))}
          onDragCancel={() => setActiveKey(null)}
          onDragEnd={finish}
        >
          <SortableContext
            items={listed.map(modelPreferenceKey)}
            strategy={verticalListSortingStrategy}
          >
            <div className="divide-y divide-border/70">
              {listed.map((model, index) => (
                <SortableModelRow
                  key={modelPreferenceKey(model)}
                  model={model}
                  shown={!hidden.has(modelPreferenceKey(model))}
                  sortable={sortable}
                  isNew={isNewModel(model, now)}
                  first={index === 0}
                  onShownChange={(value) => onShownChange([model], value)}
                  onMoveToTop={() => onMoveToTop(model)}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeModel ? (
              <div className="rounded-lg border bg-card shadow-lg">
                <ModelRow
                  model={activeModel}
                  shown={!hidden.has(modelPreferenceKey(activeModel))}
                  isNew={isNewModel(activeModel, now)}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </AccordionContent>
    </AccordionItem>
  );
}

function SortableModelRow({
  model,
  shown,
  sortable,
  isNew,
  first,
  onShownChange,
  onMoveToTop,
}: {
  model: PalotModel;
  shown: boolean;
  sortable: boolean;
  isNew: boolean;
  first: boolean;
  onShownChange(shown: boolean): void;
  onMoveToTop(): void;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition } =
    useSortable({ id: modelPreferenceKey(model), disabled: !sortable });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <ModelRow
        model={model}
        shown={shown}
        isNew={isNew}
        handle={
          <Button
            ref={setActivatorNodeRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            aria-label={`Reorder ${model.name}`}
            disabled={!sortable}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden="true" />
          </Button>
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`Move ${model.name} to the top of its provider`}
              title="Move to top of provider"
              disabled={!sortable || first}
              onClick={onMoveToTop}
            >
              <ArrowUpToLine aria-hidden="true" />
            </Button>
            <Switch
              checked={shown}
              aria-label={`Show ${model.name}`}
              onCheckedChange={(checked) => onShownChange(Boolean(checked))}
            />
          </>
        }
      />
    </div>
  );
}

function ModelRow({
  model,
  shown,
  isNew,
  handle,
  actions,
}: {
  model: PalotModel;
  shown: boolean;
  isNew: boolean;
  handle?: ReactNode;
  actions?: ReactNode;
}) {
  const cost = formatModelCost(model);
  const released = formatReleaseDate(model.releasedAt);
  return (
    <div
      data-slot="model-row"
      data-hidden={shown ? undefined : ""}
      className="flex min-w-0 items-start gap-2 py-2.5 pr-4 pl-2"
    >
      {handle ?? (
        <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
          <GripVertical className="size-3" aria-hidden="true" />
        </span>
      )}
      <div className={cn("min-w-0 flex-1", !shown && "opacity-60")}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="text-sm font-medium wrap-anywhere"
            title={released ? `Released ${released}` : undefined}
          >
            {model.name}
          </span>
          {model.status !== "active" ? (
            <Badge variant={model.status === "deprecated" ? "warning" : "info"} size="sm">
              {STATUS_LABEL[model.status]}
            </Badge>
          ) : null}
          {isNew ? (
            <Badge variant="success" size="sm">
              New
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-muted-foreground">
          <span className="font-mono text-code-compact wrap-anywhere">{model.id}</span>
          <span>{formatTokens(model.contextLimit)} context</span>
          <span>{formatTokens(model.outputLimit)} output</span>
          {model.capabilities.temperature === false ? <span>Fixed temperature</span> : null}
          {cost ? (
            <span>
              {cost.label}
              {cost.note ? ` · ${cost.note}` : ""}
            </span>
          ) : null}
          {model.variants.length ? (
            <span>
              {model.variants.length} effort level{model.variants.length === 1 ? "" : "s"}
            </span>
          ) : null}
          {released ? <span>Released {released}</span> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

function sameModel(
  model: Pick<PalotModel, "id" | "providerID">,
  ref: Pick<ModelRef, "id" | "providerID">,
) {
  return model.id === ref.id && model.providerID === ref.providerID;
}

function modelRef(model: PalotModel, variant?: string): ModelRef {
  return { id: model.id, providerID: model.providerID, ...(variant ? { variant } : {}) };
}

function sentenceCase(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}
