import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
	useStickToBottomContext,
} from "@palot/ui/components/ai-elements/conversation"
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
} from "@palot/ui/components/ai-elements/prompt-input"
import { useAtomValue } from "jotai"
import {
	ArrowUpToLineIcon,
	ChevronUpIcon,
	GitForkIcon,
	Loader2Icon,
	MonitorIcon,
	PlusIcon,
	Redo2Icon,
	SquareIcon,
	Undo2Icon,
} from "lucide-react"
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { sessionMetricsFamily } from "../../atoms/derived/session-metrics"
import { messagesFamily, removeMessageAtom } from "../../atoms/messages"
import { projectModelsAtom, setProjectModelAtom } from "../../atoms/preferences"
import type { SessionSetupPhase } from "../../atoms/sessions"
import { sessionFamily } from "../../atoms/sessions"
import { appStore } from "../../atoms/store"
import { useDraftActions, useDraftSnapshot } from "../../hooks/use-draft"
import type {
	ConfigData,
	ModelRef,
	ProvidersData,
	SdkAgent,
	VcsData,
} from "../../hooks/use-opencode-data"
import {
	getModelInputCapabilities,
	getModelVariants,
	resolveEffectiveModel,
	useModelState,
} from "../../hooks/use-opencode-data"
import type { ChatTurn } from "../../hooks/use-session-chat"
import { createLogger } from "../../lib/logger"
import { computeTurnWorkTimeSplit, formatWorkDuration } from "../../lib/session-metrics"
import type { Agent, FileAttachment, FilePart, QuestionAnswer, TextPart } from "../../lib/types"
import { getProjectClient } from "../../services/connection-manager"

const log = createLogger("chat-view")

import { PermissionItem } from "./chat-permission"
import { ChatQuestionFlow } from "./chat-question"
import { ChatTurnComponent } from "./chat-turn"
import { ContextItems } from "./context-items"
import type { MentionOption } from "./mention-popover"
import { MentionPopover, type MentionPopoverHandle } from "./mention-popover"
import { PromptAttachmentPreview } from "./prompt-attachments"
import {
	createAgentMention,
	createFileMention,
	getMentionMarker,
	insertMentionIntoText,
	type PromptMention,
	reconcileMentions,
} from "./prompt-mentions"
import { PromptToolbar, StatusBar } from "./prompt-toolbar"
import { SessionTaskList } from "./session-task-list"
import { SkillPickerDialog } from "./skill-picker-dialog"
import { SlashCommandPopover, type SlashCommandPopoverHandle } from "./slash-command-popover"

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
 * Instant-scroll when session content finishes loading.
 *
 * The `<Conversation>` (StickToBottom) uses `initial="instant"` for the first
 * paint, but messages are fetched async — by the time they arrive and render,
 * the library treats the content growth as a *resize* and applies
 * `resize="smooth"`, causing a visible scroll animation from top → bottom.
 *
 * This component sits inside `<Conversation>` so it can access the
 * StickToBottom context. It watches for the loading→loaded transition
 * and forces an instant scroll-to-bottom.
 */
function ScrollOnLoad({ loading, sessionId }: { loading: boolean; sessionId: string }) {
	const { scrollToBottom } = useStickToBottomContext()
	const prevLoadingRef = useRef(loading)
	const prevSessionRef = useRef(sessionId)

	useLayoutEffect(() => {
		const wasLoading = prevLoadingRef.current
		const sessionChanged = prevSessionRef.current !== sessionId
		prevLoadingRef.current = loading
		prevSessionRef.current = sessionId

		// Instant scroll when: loading just finished, or session changed while not loading
		// (e.g. messages were already cached in the Jotai store)
		if ((wasLoading && !loading) || (sessionChanged && !loading)) {
			scrollToBottom("instant")
		}
	}, [loading, sessionId, scrollToBottom])

	return null
}

interface ScrollHandle {
	scrollToBottom: (behavior?: "instant" | "smooth") => void
	/** Returns the current scrollHeight of the scroll container */
	getScrollHeight: () => number
	/** Smoothly scrolls the container to a specific scrollTop value */
	scrollToPosition: (top: number) => void
}

/**
 * Bridge that exposes the StickToBottom `scrollToBottom` to the parent
 * via a ref so imperative callers (handleSend, question reply, etc.)
 * can force a scroll-to-bottom even when the user has scrolled away.
 * Also exposes scroll position helpers for the "jump to start" feature.
 */
function ScrollBridge({ scrollRef }: { scrollRef: React.RefObject<ScrollHandle | null> }) {
	const ctx = useStickToBottomContext()
	useImperativeHandle(
		scrollRef,
		() => ({
			scrollToBottom: (behavior?: "instant" | "smooth") => {
				ctx.scrollToBottom(behavior ?? "smooth")
			},
			getScrollHeight: () => {
				return ctx.scrollRef.current?.scrollHeight ?? 0
			},
			scrollToPosition: (top: number) => {
				ctx.scrollRef.current?.scrollTo({ top, behavior: "smooth" })
			},
		}),
		[ctx],
	)
	return null
}

/**
 * Floating pill button that appears when the agent finishes working.
 * Scrolls to the beginning of the last assistant response so the user
 * can read it from the top. Dismisses on click or after 8 seconds.
 *
 * Captures the scroll container's scrollHeight when the agent starts
 * working (idle-to-working transition). This position corresponds to
 * "where the new response began" regardless of whether the agent
 * started from a fresh message, a question answer, or a permission grant.
 *
 * Must be rendered inside `<Conversation>` to position correctly.
 */
function ScrollToResponseStart({
	isWorking,
	scrollRef,
}: {
	isWorking: boolean
	scrollRef: React.RefObject<ScrollHandle | null>
}) {
	const [visible, setVisible] = useState(false)
	const prevWorkingRef = useRef(isWorking)
	// Saved scrollHeight at the moment the agent started working.
	// This is the Y position where the new response content begins.
	const savedScrollTopRef = useRef(0)

	useEffect(() => {
		const wasWorking = prevWorkingRef.current
		prevWorkingRef.current = isWorking

		if (!wasWorking && isWorking) {
			// Agent just started working -- snapshot where the response will begin.
			// scrollHeight is the total content height; subtracting a small offset
			// so the scroll lands slightly above the first new content.
			const handle = scrollRef.current
			if (handle) {
				savedScrollTopRef.current = Math.max(0, handle.getScrollHeight() - 80)
			}
		}

		if (wasWorking && !isWorking) {
			// Agent finished -- show the pill
			setVisible(true)
		}

		if (isWorking) {
			setVisible(false)
		}
	}, [isWorking, scrollRef])

	// Auto-dismiss after 8 seconds
	useEffect(() => {
		if (!visible) return
		const timer = setTimeout(() => setVisible(false), 8000)
		return () => clearTimeout(timer)
	}, [visible])

	const handleClick = useCallback(() => {
		scrollRef.current?.scrollToPosition(savedScrollTopRef.current)
		setVisible(false)
	}, [scrollRef])

	if (!visible) return null

	return (
		<button
			type="button"
			onClick={handleClick}
			className="absolute bottom-14 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-md transition-colors hover:bg-muted hover:text-foreground"
		>
			<ArrowUpToLineIcon className="size-3" />
			<span>Jump to start of response</span>
		</button>
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
 * Bridge that detects `/` and `@` triggers from the text input
 * and syncs popover state. Must be rendered inside PromptInputProvider.
 *
 * Uses DOM queries to find the textarea for cursor position (since
 * PromptInputTextarea doesn't support ref forwarding).
 */
function TriggerDetector({
	onSlashChange,
	onMentionChange,
}: {
	onSlashChange: (open: boolean, query: string) => void
	onMentionChange: (open: boolean, query: string) => void
}) {
	const controller = usePromptInputController()
	const inputText = controller.textInput.value

	useEffect(() => {
		// Find textarea via DOM query (PromptInputTextarea doesn't forward refs)
		const textarea = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
		const cursorPos = textarea?.selectionStart ?? inputText.length
		const textBeforeCursor = inputText.slice(0, cursorPos)

		// Slash command: entire input starts with / and no space yet
		const slashMatch = inputText.match(/^\/(\S*)$/)
		if (slashMatch) {
			onSlashChange(true, slashMatch[1])
			onMentionChange(false, "")
			return
		}

		// @mention: @ followed by non-whitespace before cursor
		const atMatch = textBeforeCursor.match(/@(\S*)$/)
		if (atMatch) {
			onMentionChange(true, atMatch[1])
			onSlashChange(false, "")
			return
		}

		// No trigger
		onSlashChange(false, "")
		onMentionChange(false, "")
	}, [inputText, onSlashChange, onMentionChange])

	return null
}

/**
 * Bridge that reconciles mentions with the current text.
 * When the user manually deletes an `@mention` marker from the text,
 * this removes the corresponding entry from the mentions list.
 * Must be rendered inside PromptInputProvider.
 */
function MentionReconciler({
	mentions,
	onReconcile,
}: {
	mentions: PromptMention[]
	onReconcile: (updated: PromptMention[]) => void
}) {
	const controller = usePromptInputController()
	const inputText = controller.textInput.value

	useEffect(() => {
		if (mentions.length === 0) return
		const reconciled = reconcileMentions(mentions, inputText)
		if (reconciled.length !== mentions.length) {
			onReconcile(reconciled)
		}
	}, [inputText, mentions, onReconcile])

	return null
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

	// Work time split for the current (last) turn — used for the live timer on the submit button.
	// Splits into completed work time (finished assistant messages) and the active start time
	// (in-progress message), so the timer shows actual agent work time, not wall-clock elapsed.
	const currentTurnWorkSplit = useMemo(() => {
		if (!isWorking || turns.length === 0) return null
		const lastTurn = turns[turns.length - 1]
		if (lastTurn.assistantMessages.length === 0) return null
		return computeTurnWorkTimeSplit(lastTurn)
	}, [isWorking, turns])

	// Mention tracking — files and agents referenced via @
	const [mentions, setMentions] = useState<PromptMention[]>([])

	// Reset mentions when session changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — clear on session switch
	useEffect(() => {
		setMentions([])
	}, [agent.sessionId])

	// Ref to imperatively scroll the conversation to bottom from outside the
	// <Conversation> tree (e.g. after sending a message or answering a question).
	const scrollRef = useRef<ScrollHandle | null>(null)

	// Session-level error and setup phase from the session atom
	const sessionEntry = useAtomValue(sessionFamily(agent.sessionId))
	const sessionError = sessionEntry?.error
	const setupPhase = sessionEntry?.setupPhase
	const sessionMetrics = useAtomValue(sessionMetricsFamily(agent.sessionId))

	// Stable callbacks for question/permission handlers — agent is stable
	// per render, but wrapping in useCallback avoids creating new inline
	// closures inside the JSX .map() that would defeat memo() on children.
	const handleReplyQuestion = useCallback(
		async (requestId: string, answers: QuestionAnswer[]) => {
			await onReplyQuestion?.(agent, requestId, answers)
			// After answering, the question card disappears and the scroll viewport
			// grows — force scroll so the latest content stays visible.
			requestAnimationFrame(() => {
				scrollRef.current?.scrollToBottom("smooth")
			})
		},
		[onReplyQuestion, agent],
	)

	const handleRejectQuestion = useCallback(
		async (requestId: string) => {
			await onRejectQuestion?.(agent, requestId)
			requestAnimationFrame(() => {
				scrollRef.current?.scrollToBottom("smooth")
			})
		},
		[onRejectQuestion, agent],
	)

	const handleApprovePermission = useCallback(
		async (a: Agent, permissionId: string, response?: "once" | "always") => {
			await onApprove?.(a, permissionId, response)
			// Permission card disappears after approval — scroll to keep content visible.
			requestAnimationFrame(() => {
				scrollRef.current?.scrollToBottom("smooth")
			})
		},
		[onApprove],
	)

	const handleDenyPermission = useCallback(
		async (a: Agent, permissionId: string) => {
			await onDeny?.(a, permissionId)
			requestAnimationFrame(() => {
				scrollRef.current?.scrollToBottom("smooth")
			})
		},
		[onDeny],
	)

	// Draft persistence — survives session switches and reloads.
	// Non-reactive snapshot: the draft is only used for PromptInputProvider's
	// initialInput (consumed once on mount). Reactive useDraft would cause the
	// entire ChatView to re-render every time the debounced draft write fires.
	const draft = useDraftSnapshot(agent.sessionId)
	const { setDraft, clearDraft } = useDraftActions(agent.sessionId)

	// Escape-to-abort: double-press within 3s
	const [interruptCount, setInterruptCount] = useState(0)
	const interruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Toolbar state
	const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null)
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
	const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)

	// Initialize model, variant, and agent from the session's last user message.
	// This ensures returning to an existing session continues with the same
	// settings, isolated from changes made in other sessions.
	// Falls back to per-project preferences when the session has no relevant info.
	const sessionMessages = useAtomValue(messagesFamily(agent.sessionId))
	const projectModels = useAtomValue(projectModelsAtom)
	const initializedForSessionRef = useRef<string | null>(null)
	const resetForSessionRef = useRef<string | null>(null)
	useEffect(() => {
		// Reset state once when switching sessions (component stays mounted across
		// session navigation, so we track which session we've reset/initialized for).
		// Seed immediately from per-project preferences to avoid a flash of empty
		// selectors while session messages load asynchronously.
		if (resetForSessionRef.current !== agent.sessionId) {
			resetForSessionRef.current = agent.sessionId
			initializedForSessionRef.current = null
			const stored = agent.directory ? projectModels[agent.directory] : undefined
			if (stored?.providerID && stored?.modelID) {
				setSelectedModel(stored)
				setSelectedVariant(stored.variant)
			} else {
				setSelectedModel(null)
				setSelectedVariant(undefined)
			}
			setSelectedAgent(stored?.agent || null)
		}

		// Wait until messages are available before initializing
		if (initializedForSessionRef.current === agent.sessionId) return
		if (!sessionMessages || sessionMessages.length === 0) return
		initializedForSessionRef.current = agent.sessionId

		// Find the last user message (iterate backwards) for model + variant + agent.
		// These override the project-level preferences seeded above.
		let foundModel = false
		let foundAgent = false
		for (let i = sessionMessages.length - 1; i >= 0; i--) {
			const msg = sessionMessages[i]
			if (msg.role !== "user") continue
			const dynamic = msg as Record<string, unknown>

			// Extract model
			if (!foundModel && "model" in msg && msg.model) {
				const model = msg.model as { providerID: string; modelID: string }
				if (model.providerID && model.modelID) {
					setSelectedModel(model)
					foundModel = true
					// variant is stored on user messages (v2 SDK type) but not
					// in the v1 TypeScript type we import -- access it dynamically.
					const variant = dynamic.variant as string | undefined
					if (variant) {
						setSelectedVariant(variant)
					} else {
						// Session message has a model but no variant -- clear the
						// project-level variant that was seeded above, since it may
						// belong to a different model.
						setSelectedVariant(undefined)
					}
				}
			}

			// Extract agent name from message metadata
			if (
				!foundAgent &&
				dynamic.agent &&
				typeof dynamic.agent === "string" &&
				dynamic.agent.length > 0
			) {
				setSelectedAgent(dynamic.agent)
				foundAgent = true
			}

			if (foundModel && foundAgent) break
		}
	}, [sessionMessages, agent.sessionId, agent.directory, projectModels])

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
			log.debug("handleSend called", {
				textLength: text.trim().length,
				hasOnSendMessage: !!onSendMessage,
				sending,
				sessionId: agent.sessionId,
			})
			if (!text.trim() || !onSendMessage || sending) {
				log.warn("handleSend bailed", {
					emptyText: !text.trim(),
					noOnSendMessage: !onSendMessage,
					sending,
				})
				return
			}

			// Check for slash commands
			if (text.trim().startsWith("/")) {
				const handled = await handleSlashCommand(text)
				if (handled) {
					clearDraft()
					setMentions([])
					return
				}
			}

			setSending(true)
			try {
				// Persist the model + variant + agent for this project so new sessions remember it
				if (effectiveModel && agent.directory) {
					appStore.set(setProjectModelAtom, {
						directory: agent.directory,
						model: {
							...effectiveModel,
							variant: selectedVariant,
							agent: selectedAgent || undefined,
						},
					})
				}

				log.debug("handleSend calling onSendMessage", {
					sessionId: agent.sessionId,
					directory: agent.directory,
					model: effectiveModel,
					agentName: selectedAgent,
					variant: selectedVariant,
					hasFiles: !!(files && files.length > 0),
				})
				// Strip mention markers from the text for a clean prompt,
				// and build file parts from tracked mentions.
				// TODO: When the SDK supports FilePart in prompt, pass them here.
				// For now, mentions are sent as inline text references.
				await onSendMessage(agent, text.trim(), {
					model: effectiveModel ?? undefined,
					agentName: selectedAgent || undefined,
					variant: selectedVariant,
					files,
				})
				log.debug("handleSend onSendMessage completed", { sessionId: agent.sessionId })
				clearDraft()
				setMentions([])
				// Force scroll to bottom after sending — the user just sent a message,
				// so they always want to see it even if they had scrolled up.
				requestAnimationFrame(() => {
					scrollRef.current?.scrollToBottom("smooth")
				})
			} catch (err) {
				log.error("handleSend failed", { sessionId: agent.sessionId }, err)
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

	// Allow sending while the AI is working — the server queues follow-up messages
	const canSend = isConnected && !sending

	const handleStop = useCallback(() => {
		if (onStop && isWorking) {
			onStop(agent)
		}
	}, [onStop, isWorking, agent])

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

	// --- Popover state (slash commands + mentions) ---
	const [slashOpen, setSlashOpen] = useState(false)
	const [slashQuery, setSlashQuery] = useState("")
	const [mentionOpen, setMentionOpen] = useState(false)
	const [mentionQuery, setMentionQuery] = useState("")

	// --- Skills picker dialog ---
	const [skillsDialogOpen, setSkillsDialogOpen] = useState(false)

	const handleSkillsOpen = useCallback(() => {
		// Clear the slash text before opening dialog
		const ctrl = slashCommandRef.current
		if (ctrl) ctrl.setText("")
		setSkillsDialogOpen(true)
	}, [])

	const handleSkillSelect = useCallback((skillName: string) => {
		// Insert `/skillname ` into the input, like the TUI does
		const ctrl = slashCommandRef.current
		if (ctrl) {
			ctrl.setText(`/${skillName} `)
		}
		// Focus the textarea
		requestAnimationFrame(() => {
			const ta = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
			if (ta) {
				ta.focus()
				const len = `/${skillName} `.length
				ta.setSelectionRange(len, len)
			}
		})
	}, [])

	const slashPopoverRef = useRef<SlashCommandPopoverHandle>(null)
	const mentionPopoverRef = useRef<MentionPopoverHandle>(null)

	// Stable callbacks for TriggerDetector
	const handleSlashTriggerChange = useCallback((open: boolean, query: string) => {
		setSlashOpen(open)
		setSlashQuery(query)
	}, [])

	const handleMentionTriggerChange = useCallback((open: boolean, query: string) => {
		setMentionOpen(open)
		setMentionQuery(query)
	}, [])

	// Close popovers
	const handleSlashClose = useCallback(() => {
		setSlashOpen(false)
		setSlashQuery("")
	}, [])

	const handleMentionClose = useCallback(() => {
		setMentionOpen(false)
		setMentionQuery("")
	}, [])

	// Slash command selection — execute and clear input
	const handleSlashSelect = useCallback(
		(command: string) => {
			handleSlashClose()
			const ctrl = slashCommandRef.current
			if (ctrl) {
				ctrl.setText(command)
				// Trigger execution via setTimeout to let React flush the state update
				setTimeout(() => {
					const trimmed = ctrl.getText().trim()
					if (trimmed.startsWith("/")) {
						handleSlashCommand(trimmed).then((handled) => {
							if (handled) {
								ctrl.setText("")
								clearDraft()
							}
						})
					}
				}, 0)
			}
		},
		[handleSlashClose, handleSlashCommand, clearDraft],
	)

	// Mention selection — insert @displayName into text + add to mentions[]
	const handleMentionSelect = useCallback(
		(option: MentionOption) => {
			handleMentionClose()
			const ctrl = slashCommandRef.current
			if (!ctrl) return

			const currentText = ctrl.getText()
			const textarea = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
			const cursorPos = textarea?.selectionStart ?? currentText.length

			const mention =
				option.type === "file" ? createFileMention(option.path) : createAgentMention(option.name)

			const { text: newText, cursorPosition: newCursor } = insertMentionIntoText(
				currentText,
				cursorPos,
				mention,
			)

			ctrl.setText(newText)

			// Add to mentions if not already present
			setMentions((prev) => {
				const key = mention.type === "file" ? `file:${mention.path}` : `agent:${mention.name}`
				if (prev.some((m) => (m.type === "file" ? `file:${m.path}` : `agent:${m.name}`) === key))
					return prev
				return [...prev, mention]
			})

			// Restore cursor position
			requestAnimationFrame(() => {
				const ta = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
				if (ta) {
					ta.focus()
					ta.setSelectionRange(newCursor, newCursor)
				}
			})
		},
		[handleMentionClose],
	)

	// Remove a mention — strip marker from text + remove from list
	const handleMentionRemove = useCallback((mention: PromptMention) => {
		const ctrl = slashCommandRef.current
		if (ctrl) {
			const marker = getMentionMarker(mention)
			const currentText = ctrl.getText()
			// Remove the marker (and trailing space if present)
			ctrl.setText(currentText.replace(`${marker} `, "").replace(marker, ""))
		}
		setMentions((prev) => {
			const key = mention.type === "file" ? `file:${mention.path}` : `agent:${mention.name}`
			return prev.filter((m) => (m.type === "file" ? `file:${m.path}` : `agent:${m.name}`) !== key)
		})
	}, [])

	// Keyboard delegation — forward to whichever popover is open
	const handleTextareaKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			// Delegate to slash popover
			if (slashOpen && slashPopoverRef.current?.handleKeyDown(e)) return
			// Delegate to mention popover
			if (mentionOpen && mentionPopoverRef.current?.handleKeyDown(e)) return

			// Escape-to-abort (only when no popover is open)
			if (e.key === "Escape") {
				handleEscapeAbort()
			}
		},
		[slashOpen, mentionOpen, handleEscapeAbort],
	)

	return (
		<div className="flex h-full flex-col">
			{/* Chat messages — constrained width for readability */}
			<div className="relative min-h-0 flex-1">
				<Conversation key={agent.sessionId} className="h-full">
					<ScrollOnLoad loading={loading} sessionId={agent.sessionId} />
					<ScrollBridge scrollRef={scrollRef} />
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
										onSendNow={isWorking ? handleSendNow : undefined}
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
							{sessionError && (
								<div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
									{"message" in sessionError.data && sessionError.data.message
										? String(sessionError.data.message)
										: `${sessionError.name}: ${JSON.stringify(sessionError.data)}`}
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
			   cannot accept prompts yet */}
			{!setupPhase && (
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

						{/* Pending permissions — always shown above input/questions */}
						{agent.permissions.length > 0 && (
							<div className="pb-2">
								{agent.permissions.map((permission) => (
									<PermissionItem
										key={permission.id}
										agent={agent}
										permission={permission}
										onApprove={handleApprovePermission}
										onDeny={handleDenyPermission}
										isConnected={isConnected}
									/>
								))}
							</div>
						)}

						{/* When questions are pending, replace the input with a focused question flow */}
						{agent.questions.length > 0 ? (
							<ChatQuestionFlow
								questions={agent.questions}
								onReply={handleReplyQuestion}
								onReject={handleRejectQuestion}
								disabled={!isConnected}
							/>
						) : (
							/* Input card — PromptInputProvider wraps everything,
						   popovers positioned relative to the card wrapper,
						   textarea as a direct child of InputGroup inside PromptInput */
							<PromptInputProvider key={agent.sessionId} initialInput={draft}>
								<DraftSync setDraft={setDraft} />
								<SlashCommandBridge controllerRef={slashCommandRef} />
								<TriggerDetector
									onSlashChange={handleSlashTriggerChange}
									onMentionChange={handleMentionTriggerChange}
								/>
								<MentionReconciler mentions={mentions} onReconcile={setMentions} />
								{/* Relative wrapper for absolutely-positioned popovers */}
								<div className="relative">
									{/* Popovers render above the card via bottom-full */}
									<SlashCommandPopover
										ref={slashPopoverRef}
										query={slashQuery}
										open={slashOpen}
										enabled={isConnected}
										directory={agent.directory}
										onSelect={handleSlashSelect}
										onSkillsOpen={handleSkillsOpen}
										onClose={handleSlashClose}
									/>
									<MentionPopover
										ref={mentionPopoverRef}
										query={mentionQuery}
										open={mentionOpen}
										directory={agent.directory}
										agents={openCodeAgents ?? []}
										onSelect={handleMentionSelect}
										onClose={handleMentionClose}
									/>
									<PromptInput
										className="rounded-xl"
										accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
										multiple
										maxFileSize={10 * 1024 * 1024}
										onSubmit={(message) => {
											if (message.text.trim() && canSend)
												handleSend(
													message.text,
													message.files.length > 0 ? message.files : undefined,
												)
										}}
									>
										{/* Mention chips above the textarea */}
										<ContextItems mentions={mentions} onRemove={handleMentionRemove} />
										<PromptAttachmentPreview
											supportsImages={modelCapabilities?.image}
											supportsPdf={modelCapabilities?.pdf}
										/>
										<PromptInputTextarea
											data-prompt-input
											onKeyDown={handleTextareaKeyDown}
											disabled={!isConnected}
											placeholder={
												isWorking ? "Send a follow-up message..." : "What would you like to do?"
											}
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
												size={isWorking && currentTurnWorkSplit ? "xs" : "icon-sm"}
											>
												{isWorking && currentTurnWorkSplit ? (
													<LiveTurnTimer
														completedMs={currentTurnWorkSplit.completedMs}
														activeStartMs={currentTurnWorkSplit.activeStartMs}
													/>
												) : undefined}
											</PromptInputSubmit>
										</PromptInputFooter>
									</PromptInput>
								</div>
							</PromptInputProvider>
						)}

						{/* Status bar — outside the card */}
						<StatusBar
							vcs={vcs ?? null}
							isConnected={isConnected}
							isWorking={isWorking}
							interruptCount={interruptCount}
							sessionId={agent.sessionId}
							providers={providers}
							sessionCost={sessionMetrics.costRaw}
							compaction={config?.compaction}
							extraSlot={
								agent.worktreePath ? (
									<div className="flex items-center gap-1">
										<GitForkIcon className="size-3" />
										<span>Worktree</span>
									</div>
								) : (
									<div className="flex items-center gap-1">
										<MonitorIcon className="size-3" />
										<span>Local</span>
									</div>
								)
							}
						/>
					</div>
				</div>
			)}

			{/* Skills picker dialog — triggered by /skills command */}
			<SkillPickerDialog
				open={skillsDialogOpen}
				onOpenChange={setSkillsDialogOpen}
				directory={agent.directory}
				onSelect={handleSkillSelect}
			/>
		</div>
	)
}

// ============================================================
// Live turn timer — ticks every second while the agent is working
// ============================================================

/**
 * Compact live timer that shows how long the current exchange has been working.
 * Uses the same completed + active split as the header's LiveWorkTime, so it
 * shows actual agent work time (sum of assistant message durations) rather than
 * wall-clock elapsed time.
 */
function LiveTurnTimer({
	completedMs,
	activeStartMs,
}: {
	completedMs: number
	activeStartMs: number | null
}) {
	const computeDisplay = useCallback(
		() =>
			formatWorkDuration(completedMs + (activeStartMs != null ? Date.now() - activeStartMs : 0)),
		[completedMs, activeStartMs],
	)

	const [elapsed, setElapsed] = useState(computeDisplay)

	useEffect(() => {
		const tick = () => setElapsed(computeDisplay())
		tick()
		// Only tick if there's an active (in-progress) message
		if (activeStartMs != null) {
			const id = setInterval(tick, 1_000)
			return () => clearInterval(id)
		}
	}, [computeDisplay, activeStartMs])

	return (
		<span className="inline-flex items-center gap-1.5 text-xs tabular-nums">
			<SquareIcon className="size-3.5" />
			{elapsed}
		</span>
	)
}

// ============================================================
// Worktree setup progress (shown in empty state during creation)
// ============================================================

const SETUP_PHASE_LABELS: Record<NonNullable<SessionSetupPhase>, string> = {
	"creating-worktree": "Creating worktree...",
	"starting-session": "Starting session...",
}

function WorktreeSetupProgress({ phase }: { phase: NonNullable<SessionSetupPhase> }) {
	return (
		<div className="flex flex-col items-center justify-center gap-4 py-16">
			<div className="flex size-12 items-center justify-center rounded-xl border border-border/50 bg-muted/30">
				<GitForkIcon className="size-5 text-muted-foreground" />
			</div>
			<div className="flex flex-col items-center gap-2">
				<div className="flex items-center gap-2">
					<Loader2Icon className="size-4 animate-spin text-muted-foreground" />
					<p className="text-sm font-medium text-foreground">{SETUP_PHASE_LABELS[phase]}</p>
				</div>
				<p className="text-xs text-muted-foreground">
					Setting up an isolated workspace for this session
				</p>
			</div>
		</div>
	)
}
