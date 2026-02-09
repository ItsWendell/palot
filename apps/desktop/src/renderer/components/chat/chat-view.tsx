import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@codedeck/ui/components/ai-elements/conversation"
import {
	PromptInput,
	PromptInputButton,
	PromptInputFooter,
	PromptInputProvider,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputAttachments,
	usePromptInputController,
} from "@codedeck/ui/components/ai-elements/prompt-input"
import { ChevronUpIcon, Loader2Icon, PlusIcon, Redo2Icon, Undo2Icon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDraft, useDraftActions } from "../../hooks/use-draft"
import type {
	ConfigData,
	ModelRef,
	ProvidersData,
	SdkAgent,
	VcsData,
} from "../../hooks/use-opencode-data"
import {
	getModelInputCapabilities,
	resolveEffectiveModel,
	useModelState,
} from "../../hooks/use-opencode-data"
import type { ChatTurn } from "../../hooks/use-session-chat"
import type { Agent, FileAttachment, QuestionAnswer } from "../../lib/types"
import { getProjectClient } from "../../services/connection-manager"
import { useAppStore } from "../../stores/app-store"
import { PermissionItem } from "./chat-permission"
import { ChatQuestionCard } from "./chat-question"
import { ChatTurnComponent } from "./chat-turn"
import { PromptAttachmentPreview } from "./prompt-attachments"
import { PromptToolbar, StatusBar } from "./prompt-toolbar"
import { SessionTaskList } from "./session-task-list"
import { SlashCommandPopover } from "./slash-command-popover"

/**
 * Small "+" button that opens the file picker for attachments.
 * Must be rendered inside a <PromptInput> so the attachments context is available.
 */
function AttachButton({ disabled }: { disabled?: boolean }) {
	const attachments = usePromptInputAttachments()
	return (
		<PromptInputButton
			tooltip="Attach files"
			onClick={() => attachments.openFileDialog()}
			disabled={disabled}
		>
			<PlusIcon className="size-4" />
		</PromptInputButton>
	)
}

/**
 * Bridge component that syncs the PromptInputProvider's text state
 * to the persisted draft store (debounced). Must be rendered inside
 * both a <PromptInputProvider> and receive draft actions for the session.
 */
function DraftSync({ setDraft }: { setDraft: (text: string) => void }) {
	const controller = usePromptInputController()
	const value = controller.textInput.value
	const isFirstRender = useRef(true)

	useEffect(() => {
		// Skip the initial render — the provider was just hydrated from the draft
		if (isFirstRender.current) {
			isFirstRender.current = false
			return
		}
		setDraft(value)
	}, [value, setDraft])

	return null
}

/**
 * Bridge that exposes the PromptInputProvider's text controller to the parent
 * via a ref, so handleSlashCommand can read/write the input text.
 */
function SlashCommandBridge({
	controllerRef,
}: {
	controllerRef: React.RefObject<{ setText: (text: string) => void; getText: () => string } | null>
}) {
	const controller = usePromptInputController()

	useEffect(() => {
		if (controllerRef && "current" in controllerRef) {
			;(controllerRef as React.MutableRefObject<typeof controllerRef.current>).current = {
				setText: (text: string) => controller.textInput.setInput(text),
				getText: () => controller.textInput.value,
			}
		}
		return () => {
			if (controllerRef && "current" in controllerRef) {
				;(controllerRef as React.MutableRefObject<typeof controllerRef.current>).current = null
			}
		}
	}, [controller, controllerRef])

	return null
}

/**
 * Wraps PromptInputTextarea with SlashCommandPopover.
 * Must be inside a PromptInputProvider to access the text controller.
 */
function SlashCommandTextarea({
	isConnected,
	isWorking,
	directory,
	handleEscapeAbort,
	handleSlashCommand,
	clearDraft,
}: {
	isConnected: boolean
	isWorking: boolean
	directory: string | null
	handleEscapeAbort: () => void
	handleSlashCommand: (text: string) => Promise<boolean>
	clearDraft: () => void
}) {
	const controller = usePromptInputController()
	const inputText = controller.textInput.value

	const handleSelect = useCallback(
		(command: string) => {
			// Set the input to the command and execute it
			handleSlashCommand(command).then((handled) => {
				if (handled) {
					controller.textInput.clear()
					clearDraft()
				} else {
					// If not handled, leave the command text in the input
					controller.textInput.setInput(command)
				}
			})
		},
		[handleSlashCommand, controller.textInput, clearDraft],
	)

	return (
		<SlashCommandPopover
			inputText={inputText}
			enabled={isConnected}
			directory={directory}
			onSelect={handleSelect}
		>
			<PromptInputTextarea
				placeholder={
					!isConnected
						? "Connect to server to send messages..."
						: isWorking
							? "Send a follow-up or correction..."
							: "Ask for follow-up changes"
				}
				disabled={!isConnected}
				className="min-h-[80px]"
				data-prompt-input
				onKeyDown={(e) => {
					if (e.key === "Escape" && isWorking && !(e.target as HTMLTextAreaElement).value.trim()) {
						e.preventDefault()
						handleEscapeAbort()
					}
				}}
			/>
		</SlashCommandPopover>
	)
}

interface ChatViewProps {
	turns: ChatTurn[]
	loading: boolean
	/** Whether earlier messages are currently being loaded */
	loadingEarlier: boolean
	/** Whether there are earlier messages that can be loaded */
	hasEarlierMessages: boolean
	/** Callback to load earlier messages */
	onLoadEarlier?: () => void
	agent: Agent
	isConnected: boolean
	onSendMessage?: (
		agent: Agent,
		message: string,
		options?: { model?: ModelRef; agentName?: string; variant?: string; files?: FileAttachment[] },
	) => Promise<void>
	/** Callback to stop/abort the running session */
	onStop?: (agent: Agent) => Promise<void>
	/** Provider data for model selector */
	providers?: ProvidersData | null
	/** Config data (default model, default agent) */
	config?: ConfigData | null
	/** VCS data for status bar */
	vcs?: VcsData | null
	/** Available OpenCode agents */
	openCodeAgents?: SdkAgent[]
	/** Permission handlers */
	onApprove?: (agent: Agent, permissionId: string, response?: "once" | "always") => Promise<void>
	onDeny?: (agent: Agent, permissionId: string) => Promise<void>
	/** Question handlers */
	onReplyQuestion?: (agent: Agent, requestId: string, answers: QuestionAnswer[]) => Promise<void>
	onRejectQuestion?: (agent: Agent, requestId: string) => Promise<void>
	/** Undo/redo */
	canUndo?: boolean
	canRedo?: boolean
	onUndo?: () => Promise<string | undefined>
	onRedo?: () => Promise<void>
	isReverted?: boolean
	/** Revert to a specific message (for per-turn undo) */
	onRevertToMessage?: (messageId: string) => Promise<void>
}

/**
 * Main chat view component.
 * Renders the full conversation as turns with auto-scroll,
 * plus a card-style input with agent/model/variant toolbar and status bar.
 */
export function ChatView({
	turns,
	loading,
	loadingEarlier,
	hasEarlierMessages,
	onLoadEarlier,
	agent,
	isConnected,
	onSendMessage,
	onStop,
	providers,
	config,
	vcs,
	openCodeAgents,
	onApprove,
	onDeny,
	onReplyQuestion,
	onRejectQuestion,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	isReverted,
	onRevertToMessage,
}: ChatViewProps) {
	const isWorking = agent.status === "running"
	const [sending, setSending] = useState(false)

	// Session-level error from session.error events
	const sessionError = useAppStore((s) => s.sessions[agent.sessionId]?.error)

	// Stable callbacks for question/permission handlers — agent is stable
	// per render, but wrapping in useCallback avoids creating new inline
	// closures inside the JSX .map() that would defeat memo() on children.
	const handleReplyQuestion = useCallback(
		async (requestId: string, answers: QuestionAnswer[]) => {
			await onReplyQuestion?.(agent, requestId, answers)
		},
		[onReplyQuestion, agent],
	)

	const handleRejectQuestion = useCallback(
		async (requestId: string) => {
			await onRejectQuestion?.(agent, requestId)
		},
		[onRejectQuestion, agent],
	)

	// Draft persistence — survives session switches and reloads
	const draft = useDraft(agent.sessionId)
	const { setDraft, clearDraft } = useDraftActions(agent.sessionId)

	// Escape-to-abort: double-press within 3s
	const [interruptCount, setInterruptCount] = useState(0)
	const interruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Toolbar state
	const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null)
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
	const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)

	// Initialize model/agent from the session's last user message (matches TUI behavior).
	// This ensures returning to an existing session continues with the same model.
	const sessionMessages = useAppStore((s) => s.messages[agent.sessionId])
	const initializedRef = useRef(false)
	useEffect(() => {
		if (initializedRef.current) return
		if (!sessionMessages || sessionMessages.length === 0) return

		// Find the last user message (iterate backwards)
		for (let i = sessionMessages.length - 1; i >= 0; i--) {
			const msg = sessionMessages[i]
			if (msg.role === "user" && "model" in msg && msg.model) {
				const model = msg.model as { providerID: string; modelID: string }
				if (model.providerID && model.modelID) {
					setSelectedModel(model)
					initializedRef.current = true
					break
				}
			}
		}
	}, [sessionMessages])

	// Recent models from model.json (for matching TUI's default model resolution)
	const { recentModels, addRecent: addRecentModel } = useModelState()

	// Resolve which OpenCode agent is active (for model resolution)
	const activeOpenCodeAgent = useMemo(() => {
		const agentName = selectedAgent ?? config?.defaultAgent
		return openCodeAgents?.find((a) => a.name === agentName) ?? null
	}, [selectedAgent, config?.defaultAgent, openCodeAgents])

	// Resolve effective model (user override > agent model > config > provider default).
	// NOTE: We intentionally do NOT pass recentModels here. For existing sessions, the
	// model should come from the session's last user message (initialized above into
	// selectedModel). The global recent list would leak model choices from other sessions.
	// recentModels are only used for the "Last used" section in the model picker UI.
	const effectiveModel = useMemo(
		() =>
			resolveEffectiveModel(
				selectedModel,
				activeOpenCodeAgent,
				config?.model,
				providers?.defaults ?? {},
				providers?.providers ?? [],
			),
		[selectedModel, activeOpenCodeAgent, config?.model, providers],
	)

	// Model input capabilities (for attachment warnings)
	const modelCapabilities = useMemo(
		() => getModelInputCapabilities(effectiveModel, providers?.providers ?? []),
		[effectiveModel, providers],
	)

	// Handle model selection — set local state + persist to model.json
	const handleModelSelect = useCallback(
		(model: ModelRef | null) => {
			setSelectedModel(model)
			if (model) addRecentModel(model)
		},
		[addRecentModel],
	)

	// Ref to the slash command handler — set from inside PromptInputProvider via SlashCommandBridge
	const slashCommandRef = useRef<{
		setText: (text: string) => void
		getText: () => string
	} | null>(null)

	/**
	 * Handle slash commands typed in the input.
	 * Returns true if the text was a slash command that was handled.
	 */
	const handleSlashCommand = useCallback(
		async (text: string): Promise<boolean> => {
			const trimmed = text.trim()
			if (!trimmed.startsWith("/")) return false

			const spaceIndex = trimmed.indexOf(" ")
			const cmdName = spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex)
			const cmdArgs = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim()

			// Client-side commands
			switch (cmdName.toLowerCase()) {
				case "undo":
					if (onUndo) await onUndo()
					return true
				case "redo":
					if (onRedo) await onRedo()
					return true
				case "compact":
				case "summarize":
					if (agent.directory) {
						const client = getProjectClient(agent.directory)
						if (client) {
							await client.session.summarize({ sessionID: agent.sessionId })
						}
					}
					return true
				default:
					break
			}

			// Try as a server-side command
			if (agent.directory) {
				const client = getProjectClient(agent.directory)
				if (client) {
					try {
						await client.session.command({
							sessionID: agent.sessionId,
							command: cmdName,
							arguments: cmdArgs,
						})
						return true
					} catch {
						// Not a recognized server command — fall through to send as regular text
					}
				}
			}

			return false
		},
		[agent, onUndo, onRedo],
	)

	const handleSend = useCallback(
		async (text: string, files?: FileAttachment[]) => {
			if (!text.trim() || !onSendMessage || sending) return

			// Check for slash commands
			if (text.trim().startsWith("/")) {
				const handled = await handleSlashCommand(text)
				if (handled) {
					clearDraft()
					return
				}
			}

			setSending(true)
			try {
				await onSendMessage(agent, text.trim(), {
					model: effectiveModel ?? undefined,
					agentName: selectedAgent ?? undefined,
					variant: selectedVariant,
					files,
				})
				clearDraft()
			} finally {
				setSending(false)
			}
		},
		[
			onSendMessage,
			sending,
			agent,
			effectiveModel,
			selectedAgent,
			selectedVariant,
			clearDraft,
			handleSlashCommand,
		],
	)

	// Keyboard shortcuts for undo/redo
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Don't intercept if focus is on a non-prompt input (like title editing)
			const target = e.target as HTMLElement
			const isInNonPromptInput =
				target.tagName === "INPUT" ||
				(target.tagName === "TEXTAREA" && !target.closest("[data-prompt-input]"))

			// Cmd+Z / Ctrl+Z — Undo
			if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
				// Allow native undo in non-prompt inputs
				if (isInNonPromptInput) return

				if (canUndo && onUndo) {
					e.preventDefault()
					onUndo()
				}
				return
			}

			// Cmd+Shift+Z / Ctrl+Shift+Z — Redo
			if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
				if (isInNonPromptInput) return

				if (canRedo && onRedo) {
					e.preventDefault()
					onRedo()
				}
				return
			}
		}

		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [canUndo, canRedo, onUndo, onRedo])

	// Allow sending while the AI is working — the server queues follow-up messages
	const canSend = isConnected && !sending

	const handleStop = useCallback(() => {
		if (onStop && isWorking) {
			onStop(agent)
		}
	}, [onStop, isWorking, agent])

	const handleEscapeAbort = useCallback(() => {
		if (!isWorking) return

		setInterruptCount((prev) => {
			const next = prev + 1
			if (next >= 2) {
				// Double-press: abort
				handleStop()
				if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current)
				return 0
			}
			// First press: start countdown
			if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current)
			interruptTimerRef.current = setTimeout(() => setInterruptCount(0), 3000)
			return next
		})
	}, [isWorking, handleStop])

	return (
		<div className="flex h-full flex-col">
			{/* Chat messages — constrained width for readability */}
			<div className="relative min-h-0 flex-1">
				<Conversation className="h-full">
					<ConversationContent className="gap-10 px-4 py-6">
						<div className="mx-auto w-full max-w-4xl space-y-10">
							{/* Load earlier messages button */}
							{hasEarlierMessages && (
								<div className="flex justify-center pb-4">
									<button
										type="button"
										onClick={onLoadEarlier}
										disabled={loadingEarlier}
										className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
									>
										{loadingEarlier ? (
											<Loader2Icon className="size-3 animate-spin" />
										) : (
											<ChevronUpIcon className="size-3" />
										)}
										{loadingEarlier ? "Loading..." : "Load earlier messages"}
									</button>
								</div>
							)}

							{loading ? (
								<div className="flex items-center justify-center py-8">
									<Loader2Icon className="size-5 animate-spin text-muted-foreground" />
									<span className="ml-2 text-sm text-muted-foreground">Loading chat...</span>
								</div>
							) : turns.length > 0 ? (
								turns.map((turn, index) => (
									<ChatTurnComponent
										key={turn.id}
										turn={turn}
										isLast={index === turns.length - 1}
										isWorking={isWorking}
										onRevertToMessage={onRevertToMessage}
									/>
								))
							) : (
								<div className="flex items-center justify-center py-8">
									<p className="text-sm text-muted-foreground">No messages yet</p>
								</div>
							)}

							{/* Session-level error from session.error events */}
							{sessionError && (
								<div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
									{"message" in sessionError.data && sessionError.data.message
										? String(sessionError.data.message)
										: `${sessionError.name}: ${JSON.stringify(sessionError.data)}`}
								</div>
							)}
						</div>
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>

				{/* Top fade */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background to-transparent"
				/>
				{/* Bottom fade */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-background to-transparent"
				/>
			</div>

			{/* Bottom input section — task list + card + status bar */}
			<div className="px-4 pb-4 pt-2">
				<div className="mx-auto w-full max-w-4xl">
					{/* Session task list — collapsible todo progress */}
					<SessionTaskList sessionId={agent.sessionId} />

					{/* Revert banner — shown when session is in undo state */}
					{isReverted && (
						<div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
							<Undo2Icon className="size-3.5 shrink-0" />
							<span className="flex-1">
								Session reverted — type to continue from here, or redo to restore
							</span>
							{canRedo && onRedo && (
								<button
									type="button"
									onClick={() => onRedo()}
									className="flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
								>
									<Redo2Icon className="size-3" />
									Redo
								</button>
							)}
						</div>
					)}

					{/* Pending questions + permissions — above the input */}
					{(agent.questions.length > 0 || agent.permissions.length > 0) && (
						<div className="pb-2">
							{agent.questions.map((q) => (
								<ChatQuestionCard
									key={q.id}
									question={q}
									onReply={handleReplyQuestion}
									onReject={handleRejectQuestion}
									disabled={!isConnected}
								/>
							))}
							{agent.permissions.map((permission) => (
								<PermissionItem
									key={permission.id}
									agent={agent}
									permission={permission}
									onApprove={onApprove}
									onDeny={onDeny}
									isConnected={isConnected}
								/>
							))}
						</div>
					)}

					{/* Input card — rounded container with textarea + toolbar inside */}
					<PromptInputProvider key={agent.sessionId} initialInput={draft}>
						<DraftSync setDraft={setDraft} />
						<SlashCommandBridge controllerRef={slashCommandRef} />
						<PromptInput
							className="rounded-xl"
							accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
							multiple
							maxFileSize={10 * 1024 * 1024}
							onSubmit={(message) => {
								if (message.text.trim() && canSend)
									handleSend(message.text, message.files.length > 0 ? message.files : undefined)
							}}
							data-prompt-input
						>
							<PromptAttachmentPreview
								supportsImages={modelCapabilities?.image}
								supportsPdf={modelCapabilities?.pdf}
							/>
							<SlashCommandTextarea
								isConnected={isConnected}
								isWorking={isWorking}
								directory={agent.directory}
								handleEscapeAbort={handleEscapeAbort}
								handleSlashCommand={handleSlashCommand}
								clearDraft={clearDraft}
							/>

							{/* Toolbar inside the card — agent + model + variant selectors + submit */}
							<PromptInputFooter>
								<PromptInputTools>
									<AttachButton disabled={!isConnected} />
									<PromptToolbar
										agents={openCodeAgents ?? []}
										selectedAgent={selectedAgent}
										defaultAgent={config?.defaultAgent}
										onSelectAgent={setSelectedAgent}
										providers={providers ?? null}
										effectiveModel={effectiveModel}
										hasModelOverride={!!selectedModel}
										onSelectModel={handleModelSelect}
										recentModels={recentModels}
										selectedVariant={selectedVariant}
										onSelectVariant={setSelectedVariant}
										disabled={!isConnected}
									/>
								</PromptInputTools>
								<PromptInputSubmit
									disabled={!canSend}
									status={isWorking ? "streaming" : undefined}
									onStop={handleStop}
								/>
							</PromptInputFooter>
						</PromptInput>
					</PromptInputProvider>

					{/* Status bar — outside the card */}
					<StatusBar
						vcs={vcs ?? null}
						isConnected={isConnected}
						isWorking={isWorking}
						interruptCount={interruptCount}
					/>
				</div>
			</div>
		</div>
	)
}
