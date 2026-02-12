import {
	SearchableListPopover,
	SearchableListPopoverContent,
	SearchableListPopoverEmpty,
	SearchableListPopoverGroup,
	SearchableListPopoverItem,
	SearchableListPopoverList,
	SearchableListPopoverSearch,
	SearchableListPopoverTrigger,
	useSearchableListPopoverSearch,
} from "@palot/ui/components/searchable-list-popover"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@palot/ui/components/select"
import { Separator } from "@palot/ui/components/separator"
import {
	CheckIcon,
	ChevronDownIcon,
	GitBranchIcon,
	ListIcon,
	MaximizeIcon,
	MinimizeIcon,
	MonitorIcon,
	SparklesIcon,
} from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import type { DisplayMode } from "../../atoms/preferences"
import { useDisplayMode, useSetDisplayMode } from "../../hooks/use-agents"
import type {
	ModelRef,
	ProvidersData,
	SdkAgent,
	SdkProvider,
	VcsData,
} from "../../hooks/use-opencode-data"
import { getModelVariants, parseModelRef } from "../../hooks/use-opencode-data"

// ============================================================
// Agent Selector
// ============================================================

interface AgentSelectorProps {
	agents: SdkAgent[]
	selectedAgent: string | null
	defaultAgent?: string
	onSelectAgent: (agentName: string) => void
	disabled?: boolean
}

export function AgentSelector({
	agents,
	selectedAgent,
	defaultAgent,
	onSelectAgent,
	disabled,
}: AgentSelectorProps) {
	if (agents.length === 0) return null

	// Resolve which agent to display. If the preferred name doesn't match any
	// available agent (e.g. stale session data, config reload), fall back to a
	// known-valid agent so the Radix Select always has a matching SelectItem.
	const preferred = selectedAgent ?? defaultAgent ?? agents[0]?.name ?? "build"
	const currentAgentObj =
		agents.find((a) => a.name === preferred) ??
		agents.find((a) => a.name === defaultAgent) ??
		agents[0]
	const currentAgent = currentAgentObj?.name ?? preferred

	return (
		<Select value={currentAgent} onValueChange={onSelectAgent} disabled={disabled}>
			<SelectTrigger
				size="sm"
				className="h-7 gap-1 border-none bg-transparent px-2 text-xs shadow-none"
			>
				<span className="flex items-center gap-1.5">
					{currentAgentObj?.color && (
						<span
							className="inline-block size-2 rounded-full"
							style={{ backgroundColor: currentAgentObj.color }}
						/>
					)}
					<span className="capitalize">{currentAgent}</span>
				</span>
			</SelectTrigger>
			<SelectContent side="top" position="popper" className="min-w-[200px]">
				{agents.map((agent) => (
					<SelectItem key={agent.name} value={agent.name}>
						<div className="flex items-center gap-2">
							{agent.color && (
								<span
									className="inline-block size-2 rounded-full"
									style={{ backgroundColor: agent.color }}
								/>
							)}
							<span className="capitalize">{agent.name}</span>
							{agent.description && (
								<span className="ml-auto text-[10px] text-muted-foreground/60">
									{agent.description.length > 30
										? `${agent.description.slice(0, 30)}...`
										: agent.description}
								</span>
							)}
						</div>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

// ============================================================
// Model Selector (Combobox-based with search)
// ============================================================

interface ModelOption {
	/** Composite value: "providerID/modelID" */
	value: string
	providerID: string
	modelID: string
	displayName: string
	providerName: string
	reasoning: boolean
}

function flattenModels(providers: SdkProvider[]): ModelOption[] {
	const models: ModelOption[] = []
	for (const provider of providers) {
		for (const [key, model] of Object.entries(provider.models)) {
			models.push({
				value: `${provider.id}/${key}`,
				providerID: provider.id,
				modelID: key,
				displayName: model.name,
				providerName: provider.name,
				reasoning: model.capabilities?.reasoning ?? false,
			})
		}
	}
	return models
}

function groupByProvider(models: ModelOption[]): Map<string, ModelOption[]> {
	const groups = new Map<string, ModelOption[]>()
	for (const model of models) {
		const existing = groups.get(model.providerName)
		if (existing) {
			existing.push(model)
		} else {
			groups.set(model.providerName, [model])
		}
	}
	return groups
}

interface ModelSelectorProps {
	providers: ProvidersData | null
	/** The resolved effective model (after agent/config/default resolution) */
	effectiveModel: ModelRef | null
	/** Whether the user has explicitly overridden the model */
	hasOverride: boolean
	onSelectModel: (model: ModelRef | null) => void
	/** Recent models from model.json (most recently used first) */
	recentModels?: ModelRef[]
	disabled?: boolean
}

export function ModelSelector({
	providers,
	effectiveModel,
	onSelectModel,
	recentModels,
	disabled,
}: ModelSelectorProps) {
	const models = useMemo(() => (providers ? flattenModels(providers.providers) : []), [providers])

	// Build "Last used" group from recentModels (up to 3, only models that exist in providers)
	const lastUsedModels = useMemo(() => {
		if (!recentModels || recentModels.length === 0) return []
		return recentModels
			.slice(0, 3)
			.map((ref) =>
				models.find((m) => m.providerID === ref.providerID && m.modelID === ref.modelID),
			)
			.filter((m): m is ModelOption => m != null)
	}, [recentModels, models])

	const activeValue = effectiveModel
		? `${effectiveModel.providerID}/${effectiveModel.modelID}`
		: null

	const activeModel = useMemo(
		() => models.find((m) => m.value === activeValue) ?? null,
		[models, activeValue],
	)

	const [open, setOpen] = useState(false)

	const handleSelect = useCallback(
		(value: string) => {
			const ref = parseModelRef(value)
			if (ref) {
				onSelectModel(ref)
			}
			setOpen(false)
		},
		[onSelectModel],
	)

	if (!providers || models.length === 0) {
		return (
			<div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
				<SparklesIcon className="size-3" />
				<span>No models</span>
			</div>
		)
	}

	return (
		<SearchableListPopover open={open} onOpenChange={setOpen}>
			<SearchableListPopoverTrigger
				className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-muted disabled:opacity-50"
				disabled={disabled}
			>
				{activeModel ? (
					<>
						<span>{activeModel.displayName}</span>
						<span className="text-muted-foreground/60">{activeModel.providerName}</span>
					</>
				) : (
					<span className="text-muted-foreground">Select model...</span>
				)}
				<ChevronDownIcon className="size-3 text-muted-foreground/60" />
			</SearchableListPopoverTrigger>
			<SearchableListPopoverContent side="top" align="start">
				<SearchableListPopoverSearch placeholder="Search models..." />
				<ModelSelectorList
					models={models}
					lastUsedModels={lastUsedModels}
					activeValue={activeValue}
					onSelect={handleSelect}
				/>
			</SearchableListPopoverContent>
		</SearchableListPopover>
	)
}

/** Inner list component — reads search from context */
function ModelSelectorList({
	models,
	lastUsedModels,
	activeValue,
	onSelect,
}: {
	models: ModelOption[]
	lastUsedModels: ModelOption[]
	activeValue: string | null
	onSelect: (value: string) => void
}) {
	const search = useSearchableListPopoverSearch()

	const filteredModels = useMemo(() => {
		if (!search) return models
		const q = search.toLowerCase()
		return models.filter(
			(m) =>
				m.displayName.toLowerCase().includes(q) ||
				m.providerName.toLowerCase().includes(q) ||
				m.modelID.toLowerCase().includes(q),
		)
	}, [models, search])

	const grouped = useMemo(() => groupByProvider(filteredModels), [filteredModels])

	return (
		<SearchableListPopoverList>
			{filteredModels.length === 0 ? (
				<SearchableListPopoverEmpty>No models found</SearchableListPopoverEmpty>
			) : (
				<>
					{/* Last used group — only shown when not searching */}
					{!search && lastUsedModels.length > 0 && (
						<SearchableListPopoverGroup label="Last used">
							{lastUsedModels.map((model) => (
								<SearchableListPopoverItem
									key={`recent-${model.value}`}
									onSelect={() => onSelect(model.value)}
								>
									<div className="min-w-0 flex-1">
										<div className="truncate">{model.displayName}</div>
										<div className="truncate text-[10px] text-muted-foreground/40">
											{model.providerName}
										</div>
									</div>
									{model.reasoning && (
										<span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground/60">
											reasoning
										</span>
									)}
									{model.value === activeValue && (
										<CheckIcon className="size-3.5 shrink-0 text-primary" />
									)}
								</SearchableListPopoverItem>
							))}
						</SearchableListPopoverGroup>
					)}

					{/* Provider-grouped models */}
					{Array.from(grouped.entries()).map(([providerName, providerModels]) => (
						<SearchableListPopoverGroup key={providerName} label={providerName}>
							{providerModels.map((model) => (
								<SearchableListPopoverItem key={model.value} onSelect={() => onSelect(model.value)}>
									<span className="min-w-0 flex-1 truncate">{model.displayName}</span>
									{model.reasoning && (
										<span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground/60">
											reasoning
										</span>
									)}
									{model.value === activeValue && (
										<CheckIcon className="size-3.5 shrink-0 text-primary" />
									)}
								</SearchableListPopoverItem>
							))}
						</SearchableListPopoverGroup>
					))}
				</>
			)}
		</SearchableListPopoverList>
	)
}

// ============================================================
// Variant Selector
// ============================================================

interface VariantSelectorProps {
	/** Available variant names for the current model */
	variants: string[]
	/** Currently selected variant (undefined = model default) */
	selectedVariant: string | undefined
	onSelectVariant: (variant: string | undefined) => void
	disabled?: boolean
}

export function VariantSelector({
	variants,
	selectedVariant,
	onSelectVariant,
	disabled,
}: VariantSelectorProps) {
	if (variants.length === 0) return null

	// "default" is a sentinel for "no variant override".
	// If the selected variant isn't in the available list (e.g. stale restore),
	// fall back to default so the <Select> doesn't show an empty/broken state.
	const value =
		selectedVariant && variants.includes(selectedVariant) ? selectedVariant : "__default__"

	return (
		<Select
			value={value}
			onValueChange={(v) => onSelectVariant(v === "__default__" ? undefined : v)}
			disabled={disabled}
		>
			<SelectTrigger
				size="sm"
				className="h-7 gap-1 border-none bg-transparent px-2 text-xs shadow-none"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent side="top" position="popper" className="min-w-[120px]">
				<SelectItem value="__default__">
					<span className="text-muted-foreground">Default variant</span>
				</SelectItem>
				{variants.map((variant) => (
					<SelectItem key={variant} value={variant}>
						<span className="capitalize">{variant}</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

// ============================================================
// Combined Prompt Toolbar
// ============================================================

export interface PromptToolbarProps {
	/** Available agents from OpenCode */
	agents: SdkAgent[]
	/** Currently selected agent name */
	selectedAgent: string | null
	/** Default agent from config */
	defaultAgent?: string
	onSelectAgent: (agentName: string) => void

	/** Provider data for model selector */
	providers: ProvidersData | null
	/** The resolved effective model */
	effectiveModel: ModelRef | null
	/** Whether the user has explicitly overridden the model */
	hasModelOverride: boolean
	onSelectModel: (model: ModelRef | null) => void

	/** Recent models from model.json */
	recentModels?: ModelRef[]

	/** Currently selected variant */
	selectedVariant: string | undefined
	onSelectVariant: (variant: string | undefined) => void

	disabled?: boolean
}

/**
 * Combined toolbar with agent, model, and variant selectors.
 * Renders inside the PromptInputFooter > PromptInputTools slot.
 */
export function PromptToolbar({
	agents,
	selectedAgent,
	defaultAgent,
	onSelectAgent,
	providers,
	effectiveModel,
	hasModelOverride,
	onSelectModel,
	recentModels,
	selectedVariant,
	onSelectVariant,
	disabled,
}: PromptToolbarProps) {
	// Compute variants for the current effective model
	const variants = useMemo(() => {
		if (!effectiveModel || !providers) return []
		return getModelVariants(effectiveModel.providerID, effectiveModel.modelID, providers.providers)
	}, [effectiveModel, providers])

	const hasAgents = agents.length > 0
	const hasVariants = variants.length > 0

	return (
		<div className="flex items-center gap-0.5">
			{hasAgents && (
				<AgentSelector
					agents={agents}
					selectedAgent={selectedAgent}
					defaultAgent={defaultAgent}
					onSelectAgent={onSelectAgent}
					disabled={disabled}
				/>
			)}

			{hasAgents && <Separator orientation="vertical" className="mx-0.5 h-4" />}

			<ModelSelector
				providers={providers}
				effectiveModel={effectiveModel}
				hasOverride={hasModelOverride}
				onSelectModel={onSelectModel}
				recentModels={recentModels}
				disabled={disabled}
			/>

			{hasVariants && <Separator orientation="vertical" className="mx-0.5 h-4" />}

			{hasVariants && (
				<VariantSelector
					variants={variants}
					selectedVariant={selectedVariant}
					onSelectVariant={onSelectVariant}
					disabled={disabled}
				/>
			)}
		</div>
	)
}

// ============================================================
// Status Bar (below the input card)
// ============================================================

interface StatusBarProps {
	vcs: VcsData | null
	isConnected: boolean
	/** Whether the session is currently running */
	isWorking?: boolean
	/** Number of Escape presses toward abort (0 = none, 1 = first press) */
	interruptCount?: number
	/** Optional slot to replace the default branch display (e.g. interactive BranchPicker) */
	branchSlot?: React.ReactNode
}

const DISPLAY_MODE_CYCLE: DisplayMode[] = ["default", "compact", "verbose"]
const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
	default: "Default",
	compact: "Compact",
	verbose: "Verbose",
}
const DISPLAY_MODE_ICONS: Record<DisplayMode, typeof ListIcon> = {
	default: ListIcon,
	compact: MinimizeIcon,
	verbose: MaximizeIcon,
}

export function StatusBar({
	vcs,
	isConnected,
	isWorking,
	interruptCount,
	branchSlot,
}: StatusBarProps) {
	const displayMode = useDisplayMode()
	const setDisplayMode = useSetDisplayMode()

	const cycleDisplayMode = useCallback(() => {
		const currentIndex = DISPLAY_MODE_CYCLE.indexOf(displayMode)
		const nextIndex = (currentIndex + 1) % DISPLAY_MODE_CYCLE.length
		setDisplayMode(DISPLAY_MODE_CYCLE[nextIndex])
	}, [displayMode, setDisplayMode])

	const DisplayModeIcon = DISPLAY_MODE_ICONS[displayMode]

	return (
		<div className="flex items-center gap-3 px-2 pt-2 text-[11px] text-muted-foreground/60">
			{/* Left side — environment + connection + interrupt hint */}
			<div className="flex items-center gap-3">
				<div className="flex items-center gap-1">
					<MonitorIcon className="size-3" />
					<span>Local</span>
				</div>

				{!isConnected && (
					<div className="flex items-center gap-1 text-yellow-500/70">
						<span className="inline-block size-1.5 rounded-full bg-yellow-500/70" />
						<span>Disconnected</span>
					</div>
				)}

				{/* Escape-to-abort hint — shown when session is working */}
				{isConnected && isWorking && (
					<div
						className={`flex items-center gap-1 transition-colors ${interruptCount && interruptCount > 0 ? "text-orange-400" : ""}`}
					>
						<kbd className="rounded border border-border px-1 py-0.5 font-mono text-[10px] leading-none">
							esc
						</kbd>
						<span>
							{interruptCount && interruptCount > 0 ? "press again to stop" : "interrupt"}
						</span>
					</div>
				)}
			</div>

			{/* Right side — display mode toggle + git branch */}
			<div className="ml-auto flex items-center gap-3">
				{/* Display mode toggle */}
				<button
					type="button"
					onClick={cycleDisplayMode}
					className="flex items-center gap-1 transition-colors hover:text-foreground"
					title={`Display: ${DISPLAY_MODE_LABELS[displayMode]} (click to cycle)`}
				>
					<DisplayModeIcon className="size-3" />
					<span>{DISPLAY_MODE_LABELS[displayMode]}</span>
				</button>

				{/* Git branch — interactive picker or read-only display */}
				{branchSlot
					? branchSlot
					: vcs?.branch && (
							<div className="flex items-center gap-1">
								<GitBranchIcon className="size-3" />
								<span className="max-w-[140px] truncate">{vcs.branch}</span>
							</div>
						)}
			</div>
		</div>
	)
}
