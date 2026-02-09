import {
	PromptInput,
	PromptInputFooter,
	PromptInputProvider,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputController,
} from "@codedeck/ui/components/ai-elements/prompt-input"
import { Popover, PopoverContent, PopoverTrigger } from "@codedeck/ui/components/popover"
import { useNavigate, useParams } from "@tanstack/react-router"
import { ChevronDownIcon, CodeIcon, FileTextIcon, GitPullRequestIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAgents, useProjectList } from "../hooks/use-agents"
import { NEW_CHAT_DRAFT_KEY, useDraft, useDraftActions } from "../hooks/use-draft"
import type { ModelRef } from "../hooks/use-opencode-data"
import {
	getModelInputCapabilities,
	resolveEffectiveModel,
	useConfig,
	useModelState,
	useOpenCodeAgents,
	useProviders,
	useVcs,
} from "../hooks/use-opencode-data"
import { useAgentActions } from "../hooks/use-server"
import type { FileAttachment } from "../lib/types"
import { getProjectClient } from "../services/connection-manager"
import { useAppStore } from "../stores/app-store"
import { BranchPicker } from "./branch-picker"
import { PromptAttachmentPreview } from "./chat/prompt-attachments"
import { PromptToolbar, StatusBar } from "./chat/prompt-toolbar"

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

	const selectedProject = useMemo(
		() => projects.find((p) => p.directory === selectedDirectory),
		[projects, selectedDirectory],
	)

	const { data: providers } = useProviders(selectedDirectory || null)
	const { data: config } = useConfig(selectedDirectory || null)
	const { data: vcs, reload: reloadVcs } = useVcs(selectedDirectory || null)
	const { agents: openCodeAgents } = useOpenCodeAgents(selectedDirectory || null)
	const { recentModels, addRecent: addRecentModel } = useModelState()

	// Derive the last-used model for this project from existing session messages.
	// This gives new chats project-scoped continuity instead of using the global recent list.
	//
	// Strategy: first check the Zustand store (fast, synchronous) for any loaded messages.
	// If no messages are in the store (common on fresh app start), fetch the most recent
	// session's messages from the server asynchronously.
	const sessions = useAppStore((s) => s.sessions)
	const storeMessages = useAppStore((s) => s.messages)
	const [projectLastModel, setProjectLastModel] = useState<ModelRef | null>(null)

	useEffect(() => {
		if (!selectedDirectory) {
			setProjectLastModel(null)
			return
		}

		// First, try to find the model from messages already in the store
		const dirSessions = Object.values(sessions)
			.filter((e) => e.directory === selectedDirectory)
			.sort((a, b) => {
				const aTime = a.session.time.updated ?? a.session.time.created
				const bTime = b.session.time.updated ?? b.session.time.created
				return bTime - aTime
			})

		for (const entry of dirSessions) {
			const msgs = storeMessages[entry.session.id]
			if (!msgs) continue
			for (let i = msgs.length - 1; i >= 0; i--) {
				const msg = msgs[i]
				if (msg.role === "user" && "model" in msg && msg.model) {
					const model = msg.model as { providerID: string; modelID: string }
					if (model.providerID && model.modelID) {
						setProjectLastModel(model)
						return
					}
				}
			}
		}

		// No messages in store — fetch from the most recent session via SDK.
		// Only need the last few messages to find the model field on the last user message.
		if (dirSessions.length > 0) {
			const mostRecent = dirSessions[0]
			const client = getProjectClient(selectedDirectory)
			if (client) {
				let cancelled = false
				client.session
					.messages({ sessionID: mostRecent.session.id, limit: 5 })
					.then((result) => {
						if (cancelled) return
						const raw = (result.data ?? []) as Array<{
							info: { role: string; model?: { providerID: string; modelID: string } }
						}>
						// Find the last user message with a model
						for (let i = raw.length - 1; i >= 0; i--) {
							const msg = raw[i].info
							if (msg.role === "user" && msg.model?.providerID && msg.model?.modelID) {
								setProjectLastModel(msg.model)
								return
							}
						}
					})
					.catch(() => {
						// Silently fail — will fall back to global recent list
					})
				return () => {
					cancelled = true
				}
			}
		}

		setProjectLastModel(null)
	}, [selectedDirectory, sessions, storeMessages])

	// Handle model selection — set local state + persist to model.json
	const handleModelSelect = useCallback(
		(model: ModelRef | null) => {
			setSelectedModel(model)
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

	// Resolve effective model — project's last-used model takes priority over global recent list
	const projectRecentModels = useMemo(() => {
		if (!projectLastModel) return recentModels
		// Prepend the project's last-used model so it wins over the global list
		const key = `${projectLastModel.providerID}/${projectLastModel.modelID}`
		const filtered = recentModels.filter((m) => `${m.providerID}/${m.modelID}` !== key)
		return [projectLastModel, ...filtered]
	}, [projectLastModel, recentModels])

	const effectiveModel = useMemo(
		() =>
			resolveEffectiveModel(
				selectedModel,
				activeOpenCodeAgent,
				config?.model,
				providers?.defaults ?? {},
				providers?.providers ?? [],
				projectRecentModels,
			),
		[selectedModel, activeOpenCodeAgent, config?.model, providers, projectRecentModels],
	)

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
						useAppStore.getState().setSessionBranch(session.id, currentBranch)
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
					{/* Icon */}
					<div className="flex justify-center">
						<div className="flex size-14 items-center justify-center rounded-full border border-border bg-background">
							<svg
								aria-hidden="true"
								className="size-7 text-foreground"
								fill="none"
								stroke="currentColor"
								strokeWidth={1.8}
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
								/>
							</svg>
						</div>
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
