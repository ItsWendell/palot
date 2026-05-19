import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@palot/ui/components/ai-elements/conversation"
import { cn } from "@palot/ui/lib/utils"
import { useAtomValue, useSetAtom } from "jotai"
import { ChevronUpIcon, Loader2Icon, Redo2Icon, Undo2Icon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { removeMessageAtom } from "../../atoms/messages"
import { sessionFamily } from "../../atoms/sessions"
import {
	effectivePermissionFamily,
	effectiveQuestionFamily,
} from "../../atoms/derived/session-requests"
import { appStore } from "../../atoms/store"
import { useDraftActions, useDraftSnapshot } from "../../hooks/use-draft"
import type {
	ConfigData,
	ModelRef,
	ProvidersData,
	SdkAgent,
	VcsData,
} from "../../hooks/use-opencode-data"
import type { ChatTurn } from "../../hooks/use-session-chat"
import { computeTurnWorkTimeSplit } from "../../lib/session-metrics"
import type { Agent, FileAttachment, FilePart, QuestionAnswer, TextPart } from "../../lib/types"

import { diffCommentsFamily } from "../review/review-comments"
import { PermissionItem } from "./chat-permission"
import { ChatQuestionFlow } from "./chat-question"
import { WorktreeSetupProgress } from "./chat-input-extras"
import { ChatInputCard, ChatInputStatus } from "./chat-input-composer"
import {
	type ScrollHandle,
	ScrollBridge,
	ScrollOnLoad,
	ScrollToResponseStart,
} from "./chat-scroll"
import { ChatTurnComponent } from "./chat-turn"
import type { PromptTextController } from "./prompt-input-bridges"
import { SessionTaskList } from "./session-task-list"
import { SkillPickerDialog } from "./skill-picker-dialog"
import type { SlashCommandPopoverHandle } from "./slash-command-popover"
import { useChatMentions } from "./use-chat-mentions"
import { useChatModelSelection } from "./use-chat-model-selection"
import { useChatSend } from "./use-chat-send"
import { useChatSkills } from "./use-chat-skills"
import { useEscapeAbort } from "./use-escape-abort"
import { useSlashCommandHandler } from "./use-slash-command-handler"
import { useSessionWatchdog } from "../../hooks/use-session-watchdog"
import { WatchdogBanner } from "./watchdog-banner"

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
	onApprove?: (
		agent: Agent,
		permissionSessionId: string,
		permissionId: string,
		response?: "once" | "always",
	) => Promise<void>
	onDeny?: (agent: Agent, permissionSessionId: string, permissionId: string) => Promise<void>
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
	/** Fork from a turn boundary (messageId of the next turn's user message, or undefined for full fork) */
	onForkFromTurn?: (messageId?: string) => Promise<void>
	/** Delete a specific part from a message (for error recovery) */
	onDeletePart?: (sessionId: string, messageId: string, partId: string) => Promise<void>
	/** Whether the review panel is open (removes max-w constraint) */
	reviewPanelOpen?: boolean
}

/**
 * Main chat view component.
 * Renders the full conversation as turns with auto-scroll,
 * plus a card-style input with agent/model/variant toolbar and status bar.
 *
 * The input section (toolbar, popovers, mentions, model/agent/variant state)
 * is extracted into `ChatInputSection` so that state changes in the input area
 * don't cause re-renders of the conversation turn list.
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
	onForkFromTurn,
	onDeletePart,
	reviewPanelOpen,
}: ChatViewProps) {
	const isWorking = agent.status === "running"

	// Ref to imperatively scroll the conversation to bottom from outside the
	// <Conversation> tree (e.g. after sending a message or answering a question).
	const scrollRef = useRef<ScrollHandle | null>(null)

	// Session-level error and setup phase from the session atom
	const sessionEntry = useAtomValue(sessionFamily(agent.sessionId))
	const sessionError = sessionEntry?.error
	const setupPhase = sessionEntry?.setupPhase
	// Format the session-level error for display. Only shown when the last
	// turn doesn't already carry an assistant-level error (the server emits
	// both session.error and message.updated for the same failure, so showing
	// both would duplicate the message).
	const sessionErrorText = useMemo(() => {
		if (!sessionError) return undefined
		if ("message" in sessionError.data && sessionError.data.message) {
			return String(sessionError.data.message)
		}
		return `${sessionError.name}: ${JSON.stringify(sessionError.data)}`
	}, [sessionError])

	const lastTurnHasError = useMemo(() => {
		const lastTurn = turns.at(-1)
		if (!lastTurn) return false
		return lastTurn.assistantMessages.some(
			(m) => m.info.role === "assistant" && m.info.error != null,
		)
	}, [turns])

	const showSessionError = !!sessionErrorText && !lastTurnHasError

	// Stable callbacks for question/permission handlers — agent is stable
	// per render, but wrapping in useCallback avoids creating new inline
	// closures inside the JSX .map() that would defeat memo() on children.
	const handleApprovePermission = useCallback(
		async (
			a: Agent,
			permissionSessionId: string,
			permissionId: string,
			response?: "once" | "always",
		) => {
			await onApprove?.(a, permissionSessionId, permissionId, response)
			// Permission card disappears after approval — scroll to keep content visible.
			requestAnimationFrame(() => {
				scrollRef.current?.scrollToBottom("smooth")
			})
		},
		[onApprove],
	)

	const handleDenyPermission = useCallback(
		async (a: Agent, permissionSessionId: string, permissionId: string) => {
			await onDeny?.(a, permissionSessionId, permissionId)
			requestAnimationFrame(() => {
				scrollRef.current?.scrollToBottom("smooth")
			})
		},
		[onDeny],
	)

	const handleSendNow = useCallback(
		async (turn: ChatTurn) => {
			if (!isWorking) return

			// Extract text and files from the queued turn BEFORE aborting, because
			// the abort may clean up state that we need.
			const text = turn.userMessage.parts
				.filter((p): p is TextPart => p.type === "text" && !p.synthetic)
				.map((p) => p.text)
				.join("\n")
			const files: FileAttachment[] = turn.userMessage.parts
				.filter((p): p is FilePart => p.type === "file")
				.map((p) => ({
					type: "file" as const,
					url: p.url,
					mediaType: p.mime,
					filename: p.filename,
				}))

			if (!text.trim()) return

			// 1. Abort the currently running turn
			if (onStop) {
				await onStop(agent)
			}

			// 2. Remove the orphaned message from the local store to prevent
			// duplicates. After an abort the server discards queued prompt
			// callbacks, so the user message is persisted on the server but no
			// response will be generated. When we re-send below, a new user
			// message + optimistic entry will be created. The server's loop
			// reads full history and will respond to the newest user message,
			// effectively ignoring the orphaned one in the context.
			appStore.set(removeMessageAtom, {
				sessionId: agent.sessionId,
				messageId: turn.userMessage.info.id,
			})

			// 3. Re-send the queued message so the server actually processes it.
			if (onSendMessage) {
				await onSendMessage(agent, text, { files: files.length > 0 ? files : undefined })
			}
		},
		[onStop, onSendMessage, isWorking, agent],
	)

	// Keyboard shortcuts for undo/redo
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Don't intercept Cmd/Ctrl+Z in any text input — let the browser
			// handle native undo/redo. Session undo/redo is still available via
			// /undo, /redo slash commands and the command palette.
			const target = e.target as HTMLElement
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return

			// Cmd+Z / Ctrl+Z — Undo
			if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
				if (canUndo && onUndo) {
					e.preventDefault()
					onUndo()
				}
				return
			}

			// Cmd+Shift+Z / Ctrl+Shift+Z — Redo
			if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
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

	// Width constraint class: remove max-w when review panel is open
	const contentWidthClass = reviewPanelOpen
		? "mx-auto w-full min-w-0"
		: "mx-auto w-full min-w-0 max-w-4xl"

	return (
		<div className="flex h-full min-w-0 flex-col overflow-hidden">
			{/* Chat messages -- constrained width for readability */}
			<div className="relative min-h-0 min-w-0 flex-1">
				<Conversation key={agent.sessionId} className="h-full">
					<ScrollOnLoad loading={loading} sessionId={agent.sessionId} />
					<ScrollBridge scrollRef={scrollRef} />
					<ConversationContent className="gap-10 px-0 py-2 sm:px-4 sm:py-6">
						<div className={cn(contentWidthClass, "space-y-10")}>
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
									onSendNow={isWorking ? handleSendNow : undefined}
									onForkFromTurn={
										onForkFromTurn
											? () => {
													const nextTurn = turns[index + 1]
													return onForkFromTurn(nextTurn?.userMessage.info.id)
												}
											: undefined
									}
									onDeletePart={onDeletePart}
								/>
							))
							) : setupPhase ? (
								<WorktreeSetupProgress phase={setupPhase} />
							) : (
								<div className="flex items-center justify-center py-8">
									<p className="text-sm text-muted-foreground">No messages yet</p>
								</div>
							)}

							{/* Session-level error from session.error events */}
							{showSessionError && sessionErrorText && (
								<div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
									{sessionErrorText}
								</div>
							)}
						</div>
					</ConversationContent>
					<ScrollToResponseStart isWorking={isWorking} scrollRef={scrollRef} />
					<ConversationScrollButton />
				</Conversation>

				{/* Top fade */}
				<div
					data-slot="scroll-fade"
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background/30 to-transparent"
				/>
				{/* Bottom fade */}
				<div
					data-slot="scroll-fade"
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-background/30 to-transparent"
				/>
			</div>

			{/* Bottom input section — hidden during worktree setup since the stub session
			   cannot accept prompts yet. Extracted into its own component so toolbar,
			   popover, mention, and model-selection state changes don't re-render the
			   conversation turn list above. */}
			{!setupPhase && (
				<ChatInputSection
					agent={agent}
					turns={turns}
					isConnected={isConnected}
					isWorking={isWorking}
					onSendMessage={onSendMessage}
					onStop={onStop}
					providers={providers}
					config={config}
					vcs={vcs}
					openCodeAgents={openCodeAgents}
					onApprove={handleApprovePermission}
					onDeny={handleDenyPermission}
					onReplyQuestion={onReplyQuestion}
					onRejectQuestion={onRejectQuestion}
					canRedo={canRedo}
					onUndo={onUndo}
					onRedo={onRedo}
					isReverted={isReverted}
					scrollRef={scrollRef}
					reviewPanelOpen={reviewPanelOpen}
					onForkFromTurn={onForkFromTurn}
				/>
			)}
		</div>
	)
}

// ============================================================
// ChatInputSection — owns all input/toolbar/popover/mention state
// ============================================================

interface ChatInputSectionProps {
	agent: Agent
	turns: ChatTurn[]
	isConnected: boolean
	isWorking: boolean
	onSendMessage?: ChatViewProps["onSendMessage"]
	onStop?: ChatViewProps["onStop"]
	providers?: ProvidersData | null
	config?: ConfigData | null
	vcs?: VcsData | null
	openCodeAgents?: SdkAgent[]
	onApprove?: (
		agent: Agent,
		permissionSessionId: string,
		permissionId: string,
		response?: "once" | "always",
	) => Promise<void>
	onDeny?: (agent: Agent, permissionSessionId: string, permissionId: string) => Promise<void>
	onReplyQuestion?: ChatViewProps["onReplyQuestion"]
	onRejectQuestion?: ChatViewProps["onRejectQuestion"]
	canRedo?: boolean
	onUndo?: () => Promise<string | undefined>
	onRedo?: () => Promise<void>
	isReverted?: boolean
	scrollRef: React.RefObject<ScrollHandle | null>
	reviewPanelOpen?: boolean
	/** Fork the current session (full fork, no cutoff) */
	onForkFromTurn?: (messageId?: string) => Promise<void>
}

function ChatInputSection({
	agent,
	turns,
	isConnected,
	isWorking,
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
	canRedo,
	onUndo,
	onRedo,
	isReverted,
	scrollRef,
	reviewPanelOpen,
	onForkFromTurn,
}: ChatInputSectionProps) {
	// Tree-scoped interactive requests — bubbles up from sub-agent sessions.
	// These replace the direct `agent.permissions` / `agent.questions` arrays
	// so the parent session's UI can respond on behalf of any descendant.
	const effectivePermission = useAtomValue(effectivePermissionFamily(agent.sessionId))
	const effectiveQuestion = useAtomValue(effectiveQuestionFamily(agent.sessionId))

	// Diff comments integration
	const diffComments = useAtomValue(diffCommentsFamily(agent.sessionId))
	const setDiffComments = useSetAtom(diffCommentsFamily(agent.sessionId))

	// Work time split for the current (last) turn — used for the live timer on the submit button.
	const currentTurnWorkSplit = useMemo(() => {
		if (!isWorking || turns.length === 0) return null
		const lastTurn = turns[turns.length - 1]
		if (lastTurn.assistantMessages.length === 0) return null
		return computeTurnWorkTimeSplit(lastTurn)
	}, [isWorking, turns])

	const textControllerRef = useRef<PromptTextController | null>(null)
	const slashPopoverRef = useRef<SlashCommandPopoverHandle>(null)

	const {
		mentions,
		setMentions,
		mentionOpen,
		mentionQuery,
		mentionPopoverRef,
		handleMentionTriggerChange,
		handleMentionClose,
		handleMentionSelect,
		handleMentionRemove,
	} = useChatMentions({
		sessionId: agent.sessionId,
		textControllerRef,
	})

	// Stable callbacks for question/permission handlers
	const handleReplyQuestion = useCallback(
		async (requestId: string, answers: QuestionAnswer[]) => {
			await onReplyQuestion?.(agent, requestId, answers)
			requestAnimationFrame(() => {
				scrollRef.current?.scrollToBottom("smooth")
			})
		},
		[onReplyQuestion, agent, scrollRef],
	)

	const handleRejectQuestion = useCallback(
		async (requestId: string) => {
			await onRejectQuestion?.(agent, requestId)
			requestAnimationFrame(() => {
				scrollRef.current?.scrollToBottom("smooth")
			})
		},
		[onRejectQuestion, agent, scrollRef],
	)

	// Draft persistence
	const draft = useDraftSnapshot(agent.sessionId)
	const { setDraft, clearDraft } = useDraftActions(agent.sessionId)

	const {
		selectedModel,
		selectedAgent,
		setSelectedAgent,
		selectedVariant,
		setSelectedVariant,
		effectiveModel,
		modelCapabilities,
		recentModels,
		handleModelSelect,
	} = useChatModelSelection({ agent, config, providers, openCodeAgents })

	const handleSlashCommand = useSlashCommandHandler({ agent, effectiveModel, onUndo, onRedo })
	const { canSend, handleSend } = useChatSend({
		agent,
		isConnected,
		onSendMessage,
		effectiveModel,
		providers,
		compaction: config?.compaction,
		selectedAgent,
		selectedVariant,
		handleSlashCommand,
		slashCommandRef: textControllerRef,
		clearDraft,
		setMentions,
		diffComments,
		setDiffComments,
		scrollRef,
	})

	const { interruptCount, handleStop, handleEscapeAbort } = useEscapeAbort({
		agent,
		isWorking,
		onStop,
	})

	const watchdogAnalysis = useSessionWatchdog(turns, isWorking)
	const [watchdogDismissed, setWatchdogDismissed] = useState(false)
	const autoRecoveryFiredRef = useRef(false)
	const autoRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Reset dismiss + fired flag when the agent stops so the next run gets a fresh slate.
	useEffect(() => {
		if (!isWorking) {
			setWatchdogDismissed(false)
			autoRecoveryFiredRef.current = false
		}
	}, [isWorking])

	const handleWatchdogNudge = useCallback(async () => {
		if (!watchdogAnalysis.recoveryPrompt) return
		setWatchdogDismissed(true)
		if (onStop) await onStop(agent)
		if (onSendMessage) await onSendMessage(agent, watchdogAnalysis.recoveryPrompt)
	}, [watchdogAnalysis.recoveryPrompt, onStop, onSendMessage, agent])

	// Auto-recovery: when the watchdog detects a stuck loop and the agent is still
	// running, automatically stop + inject the recovery prompt after a short delay.
	// The fired ref prevents re-triggering within the same stuck episode.
	useEffect(() => {
		if (autoRecoveryTimerRef.current) {
			clearTimeout(autoRecoveryTimerRef.current)
			autoRecoveryTimerRef.current = null
		}
		if (
			watchdogAnalysis.isStuck &&
			isWorking &&
			!watchdogDismissed &&
			!autoRecoveryFiredRef.current &&
			onStop &&
			onSendMessage
		) {
			autoRecoveryTimerRef.current = setTimeout(() => {
				autoRecoveryFiredRef.current = true
				handleWatchdogNudge()
			}, 8000)
		}
		return () => {
			if (autoRecoveryTimerRef.current) {
				clearTimeout(autoRecoveryTimerRef.current)
			}
		}
	}, [watchdogAnalysis.isStuck, isWorking, watchdogDismissed, handleWatchdogNudge, onStop, onSendMessage])

	// --- Slash command popover state ---
	const [slashOpen, setSlashOpen] = useState(false)
	const [slashQuery, setSlashQuery] = useState("")
	const {
		skillsDialogOpen,
		setSkillsDialogOpen,
		handleForkViaSlash,
		handleSkillsOpen,
		handleSkillSelect,
	} = useChatSkills({ textControllerRef, onForkFromTurn })

	const handleSlashTriggerChange = useCallback((open: boolean, query: string) => {
		setSlashOpen(open)
		setSlashQuery(query)
	}, [])

	const handleSlashClose = useCallback(() => {
		setSlashOpen(false)
		setSlashQuery("")
	}, [])

	const handleSlashSelect = useCallback(
		(command: string) => {
			handleSlashClose()
			const ctrl = textControllerRef.current
			// Use the command string directly instead of setText + getText round-trip,
			// which races with React's asynchronous state batching and sometimes reads
			// stale text (e.g. "/un" instead of "/undo").
			if (command.startsWith("/")) {
				handleSlashCommand(command).then((handled) => {
					if (handled) {
						if (ctrl) ctrl.setText("")
						clearDraft()
					} else if (ctrl) {
						// Not a recognized command — leave it in the input for the user
						ctrl.setText(command)
					}
				})
			} else if (ctrl) {
				ctrl.setText(command)
			}
		},
		[handleSlashClose, handleSlashCommand, clearDraft, textControllerRef],
	)

	const handleTextareaKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			// Always delegate to popovers first — they guard on their own `open` prop
			// internally, so we don't need to check slashOpen/mentionOpen here.
			// This avoids stale-closure issues where the parent's boolean lags behind
			// the popover's actual state (due to async TriggerDetector effects).
			if (slashPopoverRef.current?.handleKeyDown(e)) return
			if (mentionPopoverRef.current?.handleKeyDown(e)) return

			if (e.key === "Escape") {
				handleEscapeAbort()
			}
		},
		[handleEscapeAbort],
	)

	// Width constraint class: remove max-w when review panel is open
	const inputWidthClass = reviewPanelOpen
		? "mx-auto w-full min-w-0"
		: "mx-auto w-full min-w-0 max-w-4xl"

	return (
		<>
			<div className="min-w-0 px-0 pb-0 pt-1 sm:px-4 sm:pb-4 sm:pt-2">
				<div className={inputWidthClass}>
					{/* Watchdog banner — shown when the agent appears stuck */}
					{watchdogAnalysis.isStuck && !watchdogDismissed && (
						<WatchdogBanner
							analysis={watchdogAnalysis}
							onDismiss={() => setWatchdogDismissed(true)}
							onNudge={onStop && onSendMessage ? handleWatchdogNudge : undefined}
						/>
					)}

					{/* Session task list — collapsible todo progress */}
					<SessionTaskList sessionId={agent.sessionId} />

					{/* Revert banner — shown when session is in undo state */}
					{isReverted && (
						<div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-400">
							<Undo2Icon className="size-3.5 shrink-0" />
							<span className="flex-1">
								Session reverted — type to continue from here, or redo to restore
							</span>
							{canRedo && onRedo && (
								<button
									type="button"
									onClick={() => onRedo()}
									className="flex items-center gap-1 rounded-md bg-amber-200/60 px-2 py-1 text-[11px] font-medium text-amber-900 transition-colors hover:bg-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
								>
									<Redo2Icon className="size-3" />
									Redo
								</button>
							)}
						</div>
					)}

					{/* Pending permissions — tree-scoped: shows own OR any sub-agent's permission */}
					{effectivePermission && (
						<div className="pb-2">
							<PermissionItem
								key={effectivePermission.request.id}
								agent={agent}
								permission={effectivePermission.request}
								onApprove={onApprove}
								onDeny={onDeny}
								isConnected={isConnected}
								isFromSubAgent={effectivePermission.sessionId !== agent.sessionId}
							/>
						</div>
					)}

					{/* When questions are pending, replace the input with a focused question flow.
					    Tree-scoped: shows own OR any sub-agent's question. */}
					{effectiveQuestion ? (
						<ChatQuestionFlow
							questions={[effectiveQuestion.request]}
							isFromSubAgent={effectiveQuestion.sessionId !== agent.sessionId}
							onReply={handleReplyQuestion}
							onReject={handleRejectQuestion}
							disabled={!isConnected}
						/>
					) : (
						<ChatInputCard
							sessionId={agent.sessionId}
							directory={agent.directory}
							draft={draft}
							setDraft={setDraft}
							textControllerRef={textControllerRef}
							slashPopoverRef={slashPopoverRef}
							mentionPopoverRef={mentionPopoverRef}
							slashOpen={slashOpen}
							slashQuery={slashQuery}
							mentionOpen={mentionOpen}
							mentionQuery={mentionQuery}
							mentions={mentions}
							diffComments={diffComments}
							openCodeAgents={openCodeAgents ?? []}
							isConnected={isConnected}
							isWorking={isWorking}
							canSend={canSend}
							modelSupportsImages={modelCapabilities?.image}
							modelSupportsPdf={modelCapabilities?.pdf}
							selectedAgent={selectedAgent}
							defaultAgent={config?.defaultAgent}
							providers={providers ?? null}
							effectiveModel={effectiveModel}
							hasModelOverride={!!selectedModel}
							recentModels={recentModels}
							selectedVariant={selectedVariant}
							currentTurnWorkSplit={currentTurnWorkSplit}
							onSlashTriggerChange={handleSlashTriggerChange}
							onMentionTriggerChange={handleMentionTriggerChange}
							onSlashSelect={handleSlashSelect}
							onSkillsOpen={handleSkillsOpen}
							onForkViaSlash={handleForkViaSlash}
							onSlashClose={handleSlashClose}
							onMentionSelect={handleMentionSelect}
							onMentionClose={handleMentionClose}
							onMentionRemove={handleMentionRemove}
							onMentionsReconcile={setMentions}
							onDiffCommentRemove={(id) =>
								setDiffComments((prev) => prev.filter((comment) => comment.id !== id))
							}
							onTextareaKeyDown={handleTextareaKeyDown}
							onSubmit={(message) => {
								if (!message.text.trim() || !canSend) return
								const filteredFiles = message.files.filter((f) => {
									const isImage = f.mediaType?.startsWith("image/")
									const isPdf = f.mediaType === "application/pdf"
									if (!isImage && !isPdf) {
										console.warn("Stripping unsupported attachment", f.filename)
										return false
									}
									if (isImage && modelCapabilities?.image === false) {
										console.warn("Stripping unsupported image attachment", f.filename)
										return false
									}
									if (isPdf && modelCapabilities?.pdf === false) {
										console.warn("Stripping unsupported PDF attachment", f.filename)
										return false
									}
									return true
								})
								handleSend(message.text, filteredFiles.length > 0 ? filteredFiles : undefined)
							}}
							onStop={handleStop}
							onSelectAgent={setSelectedAgent}
							onSelectModel={handleModelSelect}
							onSelectVariant={setSelectedVariant}
						/>
					)}

					{/* Status bar — outside the card */}
					<ChatInputStatus
						vcs={vcs ?? null}
						isConnected={isConnected}
						isWorking={isWorking}
						interruptCount={interruptCount}
						sessionId={agent.sessionId}
						providers={providers}
						compaction={config?.compaction}
						worktreePath={agent.worktreePath}
					/>
				</div>
			</div>

			{/* Skills picker dialog — triggered by /skills command */}
			<SkillPickerDialog
				open={skillsDialogOpen}
				onOpenChange={setSkillsDialogOpen}
				directory={agent.directory}
				onSelect={handleSkillSelect}
			/>
		</>
	)
}
