import {
	PromptInput,
	PromptInputFooter,
	PromptInputProvider,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputController,
} from "@palot/ui/components/ai-elements/prompt-input"
import { Popover, PopoverContent, PopoverTrigger } from "@palot/ui/components/popover"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { ChevronDownIcon, CodeIcon, FileTextIcon, GitPullRequestIcon } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { projectModelsAtom, setProjectModelAtom } from "../atoms/preferences"
import { setSessionBranchAtom } from "../atoms/sessions"
import { appStore } from "../atoms/store"
import { useAgents, useProjectList } from "../hooks/use-agents"
import { NEW_CHAT_DRAFT_KEY, useDraft, useDraftActions } from "../hooks/use-draft"
import type { ModelRef } from "../hooks/use-opencode-data"
import {
	getModelInputCapabilities,
	getModelVariants,
	resolveEffectiveModel,
	useConfig,
	useModelState,
	useOpenCodeAgents,
	useProviders,
	useVcs,
} from "../hooks/use-opencode-data"
import { useAgentActions } from "../hooks/use-server"
import type { FileAttachment } from "../lib/types"
import { useSetAppBarContent } from "./app-bar-context"
import { BranchPicker } from "./branch-picker"
import { PromptAttachmentPreview } from "./chat/prompt-attachments"
import { PromptToolbar, StatusBar } from "./chat/prompt-toolbar"
import { PalotWordmark } from "./palot-wordmark"

const SUGGESTIONS = [
	{
		icon: CodeIcon,
		text: "Build a new feature based on the existing patterns in this repo.",
	},
	{
		icon: FileTextIcon,
		text: "Summarize the architecture and key design decisions.",
	},
	{
		icon: GitPullRequestIcon,
		text: "Review recent changes and suggest improvements.",
	},
]

/**
 * Syncs PromptInputProvider text to persisted drafts (debounced).
 * Must be rendered inside a <PromptInputProvider>.
 */
function DraftSync({ setDraft }: { setDraft: (text: string) => void }) {
	const controller = usePromptInputController()
	const value = controller.textInput.value
	const isFirstRender = useRef(true)

	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false
			return
		}
		setDraft(value)
	}, [value, setDraft])

	return null
}

export function NewChat() {
	const { projectSlug } = useParams({ strict: false })
	const projects = useProjectList()
	const { createSession, sendPrompt } = useAgentActions()
	const navigate = useNavigate()

	// Inject app name into the AppBar
	const setAppBarContent = useSetAppBarContent()
	useLayoutEffect(() => {
		setAppBarContent(
			<PalotWordmark className="h-[11px] w-auto shrink-0 text-muted-foreground/70" />,
		)
		return () => setAppBarContent(null)
	}, [setAppBarContent])

	const [selectedDirectory, setSelectedDirectory] = useState<string>("")
	const [launching, setLaunching] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Draft persistence — survives page reloads
	const draft = useDraft(NEW_CHAT_DRAFT_KEY)
	const { setDraft, clearDraft } = useDraftActions(NEW_CHAT_DRAFT_KEY)
	const [projectPickerOpen, setProjectPickerOpen] = useState(false)

	// Toolbar state
	const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null)
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
	const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)

	// Seed selectedModel, selectedVariant, and selectedAgent from the persisted
	// per-project preferences on first mount / project switch.
	// This puts the model at step 1 (user override) in resolveEffectiveModel, so it
	// wins over config.model and global recent list — matching the user's expectation
	// that the model they last used in this project sticks.
	const projectModels = useAtomValue(projectModelsAtom)
	const prevDirectoryRef = useRef<string>("")
	useEffect(() => {
		if (!selectedDirectory || selectedDirectory === prevDirectoryRef.current) return
		prevDirectoryRef.current = selectedDirectory
		const stored = projectModels[selectedDirectory]
		if (stored?.providerID && stored?.modelID) {
			setSelectedModel(stored)
			setSelectedVariant(stored.variant)
		} else {
			setSelectedModel(null)
			setSelectedVariant(undefined)
		}
		// Restore the per-project agent preference (null = use config default)
		setSelectedAgent(stored?.agent ?? null)
	}, [selectedDirectory, projectModels])

	const selectedProject = useMemo(
		() => projects.find((p) => p.directory === selectedDirectory),
		[projects, selectedDirectory],
	)

	const { data: providers } = useProviders(selectedDirectory || null)
	const { data: config } = useConfig(selectedDirectory || null)
	const { data: vcs, reload: reloadVcs } = useVcs(selectedDirectory || null)
	const { agents: openCodeAgents } = useOpenCodeAgents(selectedDirectory || null)
	const { recentModels, addRecent: addRecentModel } = useModelState()

	// Handle model selection — set local state + persist to model.json.
	// Reset variant when the model changes: the new model may have different
	// (or no) variants, so carrying over a stale variant would be incorrect.
	const handleModelSelect = useCallback(
		(model: ModelRef | null) => {
			setSelectedModel(model)
			setSelectedVariant(undefined)
			if (model) addRecentModel(model)
		},
		[addRecentModel],
	)

	// Count active sessions on the selected directory (for branch switch warnings)
	const allAgents = useAgents()
	const activeSessionCount = useMemo(() => {
		if (!selectedDirectory) return 0
		return allAgents.filter(
			(a) =>
				a.directory === selectedDirectory && (a.status === "running" || a.status === "waiting"),
		).length
	}, [allAgents, selectedDirectory])

	// Callback when branch is switched via the BranchPicker — forces VCS reload
	const handleBranchChanged = useCallback(
		(_branch: string) => {
			// VCS hook polls every 30s, but we want immediate UI update.
			// The SSE vcs.branch.updated event will also fire eventually.
			reloadVcs()
		},
		[reloadVcs],
	)

	// Resolve active agent for model resolution
	const activeOpenCodeAgent = useMemo(() => {
		const agentName = selectedAgent ?? config?.defaultAgent
		return openCodeAgents?.find((a) => a.name === agentName) ?? null
	}, [selectedAgent, config?.defaultAgent, openCodeAgents])

	// Resolve effective model — selectedModel is seeded from the persisted project model
	// on mount/project switch (above), so it already wins at step 1 of the resolution chain.
	const effectiveModel = useMemo(
		() =>
			resolveEffectiveModel(
				selectedModel,
				activeOpenCodeAgent,
				config?.model,
				providers?.defaults ?? {},
				providers?.providers ?? [],
				recentModels,
			),
		[selectedModel, activeOpenCodeAgent, config?.model, providers, recentModels],
	)

	// Validate variant against the effective model's available variants.
	// Clears the variant if the current model doesn't support it (e.g. restored
	// from per-project preference but the model was changed, or provider updated).
	useEffect(() => {
		if (!selectedVariant || !effectiveModel || !providers) return
		const available = getModelVariants(
			effectiveModel.providerID,
			effectiveModel.modelID,
			providers.providers,
		)
		if (!available.includes(selectedVariant)) {
			setSelectedVariant(undefined)
		}
	}, [selectedVariant, effectiveModel, providers])

	// Model input capabilities (for attachment warnings)
	const modelCapabilities = useMemo(
		() => getModelInputCapabilities(effectiveModel, providers?.providers ?? []),
		[effectiveModel, providers],
	)

	useEffect(() => {
		if (projects.length === 0) return

		if (projectSlug) {
			const match = projects.find((p) => p.slug === projectSlug)
			if (match) {
				setSelectedDirectory(match.directory)
				return
			}
		}

		setSelectedDirectory(projects[0].directory)
	}, [projectSlug, projects])

	const handleLaunch = useCallback(
		async (promptText: string, files?: FileAttachment[]) => {
			if (!selectedDirectory || !promptText) return
			setLaunching(true)
			setError(null)
			try {
				const session = await createSession(selectedDirectory)
				if (session) {
					// Capture the current branch at session creation time
					const currentBranch = vcs?.branch ?? ""
					if (currentBranch) {
						appStore.set(setSessionBranchAtom, { sessionId: session.id, branch: currentBranch })
					}

					// Persist the model + variant + agent for this project so new sessions remember it
					if (effectiveModel) {
						appStore.set(setProjectModelAtom, {
							directory: selectedDirectory,
							model: {
								...effectiveModel,
								variant: selectedVariant,
								agent: selectedAgent ?? undefined,
							},
						})
					}

					await sendPrompt(selectedDirectory, session.id, promptText, {
						model: effectiveModel ?? undefined,
						agent: selectedAgent ?? undefined,
						variant: selectedVariant,
						files,
					})
					clearDraft()
					const project = projects.find((p) => p.directory === selectedDirectory)
					navigate({
						to: "/project/$projectSlug/session/$sessionId",
						params: {
							projectSlug: project?.slug ?? "unknown",
							sessionId: session.id,
						},
					})
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to create session")
			} finally {
				setLaunching(false)
			}
		},
		[
			selectedDirectory,
			createSession,
			sendPrompt,
			projects,
			navigate,
			effectiveModel,
			selectedAgent,
			selectedVariant,
			clearDraft,
			vcs,
		],
	)

	const hasToolbar = providers

	return (
		<div className="relative flex h-full flex-col">
			{/* Hero area — vertically centered */}
			<div className="flex flex-1 flex-col items-center justify-center px-6">
				<div className="w-full max-w-4xl space-y-8">
					{/* Wordmark */}
					<div className="flex justify-center">
						<PalotWordmark className="h-4 w-auto text-foreground" />
					</div>

					{/* "Let's build" + project name */}
					<div className="text-center">
						<h1 className="text-2xl font-semibold text-foreground">Let's build</h1>
						{projects.length > 1 ? (
							<Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
								<PopoverTrigger asChild>
									<button
										type="button"
										className="mt-1 inline-flex items-center gap-1 text-xl text-muted-foreground transition-colors hover:text-foreground"
									>
										{selectedProject?.name ?? "select project"}
										<ChevronDownIcon className="size-4" />
									</button>
								</PopoverTrigger>
								<PopoverContent className="w-64 p-1" align="center">
									{projects.map((p) => (
										<button
											key={p.directory}
											type="button"
											onClick={() => {
												setSelectedDirectory(p.directory)
												setProjectPickerOpen(false)
											}}
											className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
												p.directory === selectedDirectory
													? "bg-muted text-foreground"
													: "text-muted-foreground"
											}`}
										>
											<span className="truncate font-medium">{p.name}</span>
											<span className="ml-auto text-xs text-muted-foreground/60">
												{p.agentCount}
											</span>
										</button>
									))}
								</PopoverContent>
							</Popover>
						) : (
							<p className="mt-1 text-xl text-muted-foreground">{selectedProject?.name ?? ""}</p>
						)}
					</div>

					{/* Suggestion cards — 3 column grid */}
					<div className="grid grid-cols-3 gap-3">
						{SUGGESTIONS.map((suggestion) => {
							const Icon = suggestion.icon
							return (
								<button
									key={suggestion.text}
									type="button"
									onClick={() => handleLaunch(suggestion.text)}
									disabled={launching || !selectedDirectory}
									className="group/card flex flex-col gap-3 rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-muted-foreground/30 hover:bg-muted/50 disabled:opacity-50"
								>
									<Icon className="size-5 text-muted-foreground transition-colors group-hover/card:text-foreground" />
									<p className="text-sm leading-snug text-muted-foreground transition-colors group-hover/card:text-foreground">
										{suggestion.text}
									</p>
								</button>
							)
						})}
					</div>
				</div>
			</div>

			{/* Bottom-pinned input section */}
			<div className="shrink-0 px-6 pb-5 pt-3">
				<div className="mx-auto w-full max-w-4xl">
					{/* Input card */}
					<PromptInputProvider key={NEW_CHAT_DRAFT_KEY} initialInput={draft}>
						<DraftSync setDraft={setDraft} />
						<PromptInput
							className="rounded-xl"
							accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
							multiple
							maxFileSize={10 * 1024 * 1024}
							onSubmit={(message) => {
								if (message.text.trim())
									handleLaunch(
										message.text.trim(),
										message.files.length > 0 ? message.files : undefined,
									)
							}}
						>
							<PromptAttachmentPreview
								supportsImages={modelCapabilities?.image}
								supportsPdf={modelCapabilities?.pdf}
							/>
							<PromptInputTextarea
								placeholder="What should this session work on?"
								autoFocus
								disabled={launching || !selectedDirectory || projects.length === 0}
								className="min-h-[80px]"
							/>

							{/* Toolbar inside the card — agent + model + variant selectors */}
							{hasToolbar && (
								<PromptInputFooter>
									<PromptInputTools>
										<PromptToolbar
											agents={openCodeAgents ?? []}
											selectedAgent={selectedAgent}
											defaultAgent={config?.defaultAgent}
											onSelectAgent={setSelectedAgent}
											providers={providers}
											effectiveModel={effectiveModel}
											hasModelOverride={!!selectedModel}
											onSelectModel={handleModelSelect}
											recentModels={recentModels}
											selectedVariant={selectedVariant}
											onSelectVariant={setSelectedVariant}
										/>
									</PromptInputTools>
								</PromptInputFooter>
							)}
						</PromptInput>
					</PromptInputProvider>

					{/* Status bar — outside the card */}
					{providers && (
						<StatusBar
							vcs={vcs ?? null}
							isConnected={true}
							branchSlot={
								selectedDirectory ? (
									<BranchPicker
										directory={selectedDirectory}
										currentBranch={vcs?.branch}
										onBranchChanged={handleBranchChanged}
										activeSessionCount={activeSessionCount}
									/>
								) : undefined
							}
						/>
					)}

					{/* Error */}
					{error && (
						<div className="mt-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500">
							{error}
						</div>
					)}

					{/* No projects warning */}
					{projects.length === 0 && (
						<p className="mt-2 text-center text-xs text-muted-foreground">
							No projects found. Check that projects exist in ~/.local/share/opencode/storage/.
						</p>
					)}
				</div>
			</div>
		</div>
	)
}
