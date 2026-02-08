import { Popover, PopoverContent, PopoverTrigger } from "@codedeck/ui/components/popover"
import { ScrollArea } from "@codedeck/ui/components/scroll-area"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@codedeck/ui/components/select"
import { Separator } from "@codedeck/ui/components/separator"
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDisplayMode, useSetDisplayMode } from "../../hooks/use-agents"
import type {
	ModelRef,
	ProvidersData,
	SdkAgent,
	SdkProvider,
	VcsData,
} from "../../hooks/use-opencode-data"
import { getModelVariants, parseModelRef } from "../../hooks/use-opencode-data"
import type { DisplayMode } from "../../stores/persisted-store"

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

	const currentAgent = selectedAgent ?? defaultAgent ?? agents[0]?.name ?? "build"

	const currentAgentObj = agents.find((a) => a.name === currentAgent)

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
	const [search, setSearch] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)

	// Reset search when popover closes
	useEffect(() => {
		if (!open) setSearch("")
	}, [open])

	// Auto-focus search input when popover opens
	useEffect(() => {
		if (open) {
			// Small delay to let the popover render before focusing
			const timer = setTimeout(() => inputRef.current?.focus(), 0)
			return () => clearTimeout(timer)
		}
	}, [open])

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
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
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
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="start"
				className="w-72 p-0"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				{/* Search input */}
				<div className="border-b px-3 py-2">
					<input
						ref={inputRef}
						type="text"
						placeholder="Search models..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
					/>
				</div>

				{/* Model list with ScrollArea */}
				<ScrollArea className="max-h-64 overflow-hidden [&>[data-radix-scroll-area-viewport]]:max-h-[inherit]">
					{filteredModels.length === 0 ? (
						<div className="py-4 text-center text-sm text-muted-foreground">No models found</div>
					) : (
						<>
							{/* Last used group — only shown when not searching */}
							{!search && lastUsedModels.length > 0 && (
								<div>
									<div className="sticky top-0 z-10 border-b bg-popover px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
										Last used
									</div>
									{lastUsedModels.map((model) => (
										<button
											key={`recent-${model.value}`}
											type="button"
											onClick={() => handleSelect(model.value)}
											className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
										>
											<span className="flex-1 truncate">{model.displayName}</span>
											<span className="shrink-0 text-[10px] text-muted-foreground/40">
												{model.providerName}
											</span>
											{model.reasoning && (
												<span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground/60">
													reasoning
												</span>
											)}
											{model.value === activeValue && (
												<CheckIcon className="size-3.5 shrink-0 text-primary" />
											)}
										</button>
									))}
								</div>
							)}

							{/* Provider-grouped models */}
							{Array.from(grouped.entries()).map(([providerName, providerModels]) => (
								<div key={providerName}>
									{/* Sticky provider header */}
									<div className="sticky top-0 z-10 border-b bg-popover px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
										{providerName}
									</div>
									{/* Models in this provider group */}
									{providerModels.map((model) => (
										<button
											key={model.value}
											type="button"
											onClick={() => handleSelect(model.value)}
											className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
										>
											<span className="flex-1 truncate">{model.displayName}</span>
											{model.reasoning && (
												<span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground/60">
													reasoning
												</span>
											)}
											{model.value === activeValue && (
												<CheckIcon className="size-3.5 shrink-0 text-primary" />
											)}
										</button>
									))}
								</div>
							))}
						</>
					)}
				</ScrollArea>
			</PopoverContent>
		</Popover>
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

	// "default" is a sentinel for "no variant override"
	const value = selectedVariant ?? "__default__"

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
					<span className="text-muted-foreground">default</span>
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

export function StatusBar({ vcs, isConnected, isWorking, interruptCount }: StatusBarProps) {
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

				{/* Git branch */}
				{vcs?.branch && (
					<div className="flex items-center gap-1">
						<GitBranchIcon className="size-3" />
						<span className="max-w-[140px] truncate">{vcs.branch}</span>
					</div>
				)}
			</div>
		</div>
	)
}
