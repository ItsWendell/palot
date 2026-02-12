import {
	Message,
	MessageAction,
	MessageActions,
	MessageContent,
	MessageResponse,
} from "@palot/ui/components/ai-elements/message"
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@palot/ui/components/ai-elements/reasoning"
import { Shimmer } from "@palot/ui/components/ai-elements/shimmer"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@palot/ui/components/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@palot/ui/components/tooltip"
import {
	BotIcon,
	CheckIcon,
	ChevronDownIcon,
	CopyIcon,
	EditIcon,
	EyeIcon,
	FileIcon,
	GlobeIcon,
	ListOrderedIcon,
	SendIcon,
	TerminalIcon,
	Undo2Icon,
	WrenchIcon,
	ZapIcon,
} from "lucide-react"
import { memo, useCallback, useDeferredValue, useMemo, useState } from "react"
import { useDisplayMode } from "../../hooks/use-agents"
import type { ChatMessageEntry, ChatTurn as ChatTurnType } from "../../hooks/use-session-chat"
import type { FilePart, Part, ReasoningPart, TextPart, ToolPart } from "../../lib/types"
import { ChatToolCall } from "./chat-tool-call"
import { getToolCategory, type ToolCategory } from "./tool-card"

// ============================================================
// Utility functions
// ============================================================

/**
 * Formats a timestamp (milliseconds) to relative or absolute time.
 */
export function formatTimestamp(ms: number): string {
	const date = new Date(ms)
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

/**
 * Computes duration between two timestamps.
 */
function computeDuration(start: number, end?: number): string {
	const ms = (end ?? Date.now()) - start
	const seconds = Math.floor(ms / 1000)
	if (seconds < 60) return `${seconds}s`
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = seconds % 60
	return `${minutes}m ${remainingSeconds}s`
}

// ============================================================
// Status computation — follows into sub-agents
// ============================================================

/**
 * Computes a status string from the last active part.
 * Follows into sub-agent sessions for deeper status.
 */
function computeStatus(parts: Part[]): string {
	for (let i = parts.length - 1; i >= 0; i--) {
		const part = parts[i]
		if (part.type === "tool") {
			switch (part.tool) {
				case "task": {
					// Show what the sub-agent is actually doing
					const desc = part.state.input?.description as string | undefined
					const shortDesc = desc && desc.length > 30 ? `${desc.slice(0, 27)}...` : desc
					return shortDesc ? `Agent: ${shortDesc}` : "Delegating..."
				}
				case "todowrite":
				case "todoread":
					return "Planning..."
				case "read":
					return "Reading files..."
				case "list":
				case "grep":
				case "glob":
					return "Searching codebase..."
				case "webfetch":
					return "Fetching web content..."
				case "edit":
				case "write":
				case "apply_patch":
					return "Making edits..."
				case "bash":
					return "Running command..."
				case "question":
					return "Asking a question..."
				default:
					return `Running ${part.tool}...`
			}
		}
		if (part.type === "reasoning") return "Thinking..."
		if (part.type === "text") return "Composing response..."
	}
	return "Working..."
}

// ============================================================
// Icon-pill summary bar
// ============================================================

/** Category info for icon pills */
interface CategoryPill {
	category: ToolCategory
	count: number
	icon: typeof WrenchIcon
	label: string
}

/**
 * Groups tool parts into category pills for the compact summary.
 */
function getToolPills(toolParts: ToolPart[]): CategoryPill[] {
	const counts: Partial<Record<ToolCategory, number>> = {}
	for (const part of toolParts) {
		if (part.tool === "todowrite" || part.tool === "todoread") continue
		const cat = getToolCategory(part.tool)
		counts[cat] = (counts[cat] ?? 0) + 1
	}

	const pills: CategoryPill[] = []
	const mapping: Array<{
		category: ToolCategory
		icon: typeof WrenchIcon
		label: string
	}> = [
		{ category: "explore", icon: EyeIcon, label: "read" },
		{ category: "edit", icon: EditIcon, label: "edit" },
		{ category: "run", icon: TerminalIcon, label: "run" },
		{ category: "delegate", icon: ZapIcon, label: "agent" },
		{ category: "fetch", icon: GlobeIcon, label: "fetch" },
		{ category: "ask", icon: WrenchIcon, label: "ask" },
		{ category: "other", icon: WrenchIcon, label: "tool" },
	]

	for (const { category, icon, label } of mapping) {
		const count = counts[category]
		if (count && count > 0) {
			pills.push({ category, count, icon, label })
		}
	}

	return pills
}

/** Single pill in the summary bar */
const ToolPill = memo(function ToolPill({ pill }: { pill: CategoryPill }) {
	const Icon = pill.icon
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
					<Icon className="size-3" />
					<span>{pill.count}</span>
				</span>
			</TooltipTrigger>
			<TooltipContent side="top">
				<p className="text-xs">
					{pill.count} {pill.label} {pill.count === 1 ? "call" : "calls"}
				</p>
			</TooltipContent>
		</Tooltip>
	)
})

// ============================================================
// Synthetic message helpers
// ============================================================

function isSyntheticMessage(entry: ChatMessageEntry): boolean {
	const textParts = entry.parts.filter((p): p is TextPart => p.type === "text")
	// All text parts are synthetic (e.g. compaction continuation, shell execution)
	if (textParts.length > 0 && textParts.every((p) => p.synthetic === true)) return true
	// No text parts at all — e.g. a user message with only a compaction part
	if (textParts.length === 0 && entry.parts.length > 0) return true
	return false
}

function getUserText(entry: ChatMessageEntry): string {
	return entry.parts
		.filter((p): p is TextPart => p.type === "text" && !p.synthetic)
		.map((p) => p.text)
		.join("\n")
}

function getSyntheticLabel(entry: ChatMessageEntry): string {
	const text = entry.parts
		.filter((p): p is TextPart => p.type === "text")
		.map((p) => p.text)
		.join("\n")
		.toLowerCase()

	if (text.includes("continue if you have next steps")) return "Auto-continued after compaction"
	if (text.includes("summarize the task tool output")) return "Auto-continued after task"
	if (text.includes("tool was executed by the user")) return "Shell command executed"
	if (text.includes("plan has been approved")) return "Plan approved"
	if (text.includes("enter plan mode")) return "Entered plan mode"
	if (text.includes("switch") && text.includes("plan")) return "Mode switched"
	// No text parts — check for compaction part (user message that triggers compaction)
	if (entry.parts.some((p) => p.type === "compaction")) return "Compacting conversation"
	return "Auto-continued"
}

function getFileParts(entry: ChatMessageEntry): FilePart[] {
	return entry.parts.filter(
		(p): p is FilePart =>
			p.type === "file" && (p.mime.startsWith("image/") || p.mime === "application/pdf"),
	)
}

// ============================================================
// Attachment grid
// ============================================================

const AttachmentGrid = memo(function AttachmentGrid({ files }: { files: FilePart[] }) {
	if (files.length === 0) return null
	return (
		<div className="flex flex-wrap gap-2">
			{files.map((file) => (
				<AttachmentThumbnail key={file.id} file={file} />
			))}
		</div>
	)
})

function AttachmentThumbnail({ file }: { file: FilePart }) {
	const isImage = file.mime.startsWith("image/")
	return (
		<Dialog>
			<DialogTrigger asChild>
				<button
					type="button"
					className="group/thumb relative size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-muted transition-colors hover:border-muted-foreground/30"
				>
					{isImage ? (
						<img
							src={file.url}
							alt={file.filename ?? "Image attachment"}
							className="size-full object-cover"
						/>
					) : (
						<div className="flex size-full items-center justify-center">
							<FileIcon className="size-6 text-muted-foreground" />
						</div>
					)}
					{file.filename && (
						<div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-[9px] leading-tight text-white opacity-0 transition-opacity group-hover/thumb:opacity-100">
							<span className="line-clamp-1">{file.filename}</span>
						</div>
					)}
				</button>
			</DialogTrigger>
			<DialogContent className="max-h-[90vh] max-w-4xl overflow-auto p-0">
				<DialogTitle className="sr-only">{file.filename ?? "Attachment preview"}</DialogTitle>
				{isImage ? (
					<img
						src={file.url}
						alt={file.filename ?? "Image attachment"}
						className="max-h-[85vh] w-full object-contain"
					/>
				) : (
					<div className="flex flex-col items-center justify-center gap-2 p-8">
						<FileIcon className="size-12 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">{file.filename ?? "PDF attachment"}</p>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}

// ============================================================
// Part extraction helpers
// ============================================================

/** A renderable part — either a tool call, an intermediate text block, or reasoning */
type RenderablePart =
	| { kind: "tool"; part: ToolPart }
	| { kind: "text"; id: string; text: string }
	| { kind: "reasoning"; part: ReasoningPart }

/**
 * Flattens all assistant parts into an ordered list of renderable items
 * AND extracts the tool-only subset in a single pass.
 * Preserves the natural order: text, reasoning, tool, text, tool, text...
 * Filters out synthetic text, todoread without output, and empty text.
 * Strips OpenRouter [REDACTED] chunks from reasoning and skips empty reasoning.
 */
function getPartsAndTools(assistantMessages: ChatMessageEntry[]): {
	ordered: RenderablePart[]
	tools: ToolPart[]
} {
	const ordered: RenderablePart[] = []
	const tools: ToolPart[] = []
	for (const msg of assistantMessages) {
		for (const part of msg.parts) {
			if (part.type === "tool") {
				tools.push(part)
				if (part.tool === "todoread" && part.state.status !== "completed") continue
				ordered.push({ kind: "tool", part })
			} else if (part.type === "text" && !part.synthetic && part.text.trim()) {
				ordered.push({ kind: "text", id: part.id, text: part.text })
			} else if (part.type === "reasoning") {
				// Strip OpenRouter's encrypted [REDACTED] chunks
				const cleaned = part.text.replace("[REDACTED]", "").trim()
				if (cleaned) {
					ordered.push({ kind: "reasoning", part })
				}
			}
		}
	}
	return { ordered, tools }
}

/**
 * Gets the last text part's content — used for the final streaming response
 * and the copy action. Returns undefined if no text parts exist.
 */
function getLastResponseText(orderedParts: RenderablePart[]): string | undefined {
	for (let i = orderedParts.length - 1; i >= 0; i--) {
		const item = orderedParts[i]
		if (item.kind === "text") return item.text
	}
	return undefined
}

function getError(assistantMessages: ChatMessageEntry[]): string | undefined {
	for (const msg of assistantMessages) {
		if (msg.info.role === "assistant" && msg.info.error) {
			const error = msg.info.error
			const errorData = error.data
			// Most error types have a `message` string in data
			if ("message" in errorData && errorData.message) {
				return typeof errorData.message === "string" ? errorData.message : String(errorData.message)
			}
			// Fallback: use the error name (e.g. "MessageOutputLengthError") +
			// any stringifiable data for types like MessageOutputLengthError
			// whose data is { [key: string]: unknown }
			const dataStr = Object.keys(errorData).length > 0 ? JSON.stringify(errorData) : undefined
			return dataStr ? `${error.name}: ${dataStr}` : error.name
		}
	}
	return undefined
}

/** Check if any tool parts have errors */
function hasToolErrors(toolParts: ToolPart[]): boolean {
	return toolParts.some((p) => p.state.status === "error")
}

// ============================================================
// ChatTurnComponent
// ============================================================

interface ChatTurnProps {
	turn: ChatTurnType
	isLast: boolean
	isWorking: boolean
	/** Revert to this turn's user message (for per-turn undo) */
	onRevertToMessage?: (messageId: string) => Promise<void>
	/** Interrupt the current work and send this queued message immediately */
	onSendNow?: () => Promise<void>
}

/**
 * Renders a single turn: user message + assistant response.
 *
 * Two modes based on turn state:
 * - **Active turn** (last + working): tool calls are individually rendered with
 *   per-tool ToolCards, smart default expand/collapse, and live activity.
 * - **Completed turn**: icon-pill summary bar with one-click expand to show
 *   individual tools. Response text is always visible.
 *
 * Display mode preference (default/compact/verbose) modifies behavior:
 * - default: active turn shows tools, completed turns use pill bar
 * - compact: active turn shows only last 3 tools, rest in pill bar
 * - verbose: all turns show all tools expanded
 */
export const ChatTurnComponent = memo(function ChatTurnComponent({
	turn,
	isLast,
	isWorking,
	onRevertToMessage,
	onSendNow,
}: ChatTurnProps) {
	const [stepsExpanded, setStepsExpanded] = useState(false)
	const [copied, setCopied] = useState(false)
	const displayMode = useDisplayMode()

	const isSynthetic = useMemo(() => isSyntheticMessage(turn.userMessage), [turn.userMessage])
	const userText = useMemo(() => getUserText(turn.userMessage), [turn.userMessage])
	const syntheticLabel = useMemo(
		() => (isSynthetic ? getSyntheticLabel(turn.userMessage) : ""),
		[isSynthetic, turn.userMessage],
	)
	const userFiles = useMemo(() => getFileParts(turn.userMessage), [turn.userMessage])

	// Ordered parts + tool-only subset in a single pass (avoids double iteration)
	const { ordered: orderedParts, tools: toolParts } = useMemo(
		() => getPartsAndTools(turn.assistantMessages),
		[turn.assistantMessages],
	)

	// The last text for streaming display and copy action
	const rawResponseText = useMemo(() => getLastResponseText(orderedParts), [orderedParts])
	const responseText = useDeferredValue(rawResponseText)

	const errorText = useMemo(() => getError(turn.assistantMessages), [turn.assistantMessages])

	// Compute status by walking the last message's parts in reverse — no
	// need to flatMap all messages into a temporary array.
	const statusText = useMemo(() => {
		for (let m = turn.assistantMessages.length - 1; m >= 0; m--) {
			const status = computeStatus(turn.assistantMessages[m].parts)
			if (status !== "Working...") return status
		}
		return "Working..."
	}, [turn.assistantMessages])

	const working = isLast && isWorking
	const isQueued = isWorking && turn.assistantMessages.length === 0 && !isLast
	const isQueuedLast = isWorking && turn.assistantMessages.length === 0 && isLast
	const hasSteps = toolParts.length > 0
	const hasReasoning = orderedParts.some((p) => p.kind === "reasoning")
	const hasErrors = useMemo(() => hasToolErrors(toolParts), [toolParts])
	const lastAssistant = turn.assistantMessages.at(-1)
	const duration = useMemo(() => {
		const lastInfo = lastAssistant?.info
		const completed = lastInfo?.role === "assistant" ? lastInfo.time.completed : undefined
		return computeDuration(turn.userMessage.info.time.created, completed)
	}, [turn.userMessage.info.time.created, lastAssistant?.info])

	// Icon pills for the compact summary bar
	const pills = useMemo(() => getToolPills(toolParts), [toolParts])

	// Determine if tools should be shown individually (active turn behavior)
	const isActiveTurn = working
	const showToolsExpanded = displayMode === "verbose" || isActiveTurn || stepsExpanded

	// In compact mode during active turn, only show the last N ordered parts
	const visibleParts = useMemo(() => {
		if (displayMode === "compact" && isActiveTurn && orderedParts.length > 5) {
			return orderedParts.slice(-5)
		}
		return orderedParts
	}, [displayMode, isActiveTurn, orderedParts])

	// How many parts are hidden in compact mode
	const hiddenCount =
		displayMode === "compact" && isActiveTurn ? Math.max(0, orderedParts.length - 5) : 0

	// When expanded, all text parts are already rendered inline within the
	// ordered parts list. The separate "final response" block should only
	// appear when collapsed (pill bar mode) to show the response below the summary.
	// Note: text is only inline if the tools/steps section actually renders
	// (requires working || hasSteps || hasReasoning), otherwise the inline
	// rendering block is skipped and we must fall through to the standalone block.
	const toolsSectionVisible = working || hasSteps || hasReasoning
	const textAlreadyInline =
		showToolsExpanded && toolsSectionVisible && orderedParts.some((p) => p.kind === "text")

	const handleCopyResponse = useCallback(async () => {
		if (!responseText) return
		await navigator.clipboard.writeText(responseText)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [responseText])

	const handleRevertHere = useCallback(async () => {
		if (!onRevertToMessage) return
		await onRevertToMessage(turn.userMessage.info.id)
	}, [onRevertToMessage, turn.userMessage.info.id])

	const [sendingNow, setSendingNow] = useState(false)
	const handleSendNow = useCallback(async () => {
		if (!onSendNow || sendingNow) return
		setSendingNow(true)
		try {
			await onSendNow()
		} finally {
			setSendingNow(false)
		}
	}, [onSendNow, sendingNow])

	return (
		<div className="group/turn space-y-4">
			{/* User message */}
			{isSynthetic ? (
				<div className="flex items-center justify-end gap-1.5 text-[11px] italic text-muted-foreground/50">
					<BotIcon className="size-3" aria-hidden="true" />
					<span>{syntheticLabel}</span>
				</div>
			) : (
				<Message from="user">
					<MessageContent>
						{userFiles.length > 0 && <AttachmentGrid files={userFiles} />}
						<p className="whitespace-pre-wrap">{userText}</p>
						{(isQueued || isQueuedLast) && (
							<span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/60">
								<ListOrderedIcon className="size-3" />
								Queued
								{onSendNow && (
									<button
										type="button"
										onClick={handleSendNow}
										disabled={sendingNow}
										className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
									>
										<SendIcon className="size-2.5" />
										{sendingNow ? "Sending..." : "Send now"}
									</button>
								)}
							</span>
						)}
					</MessageContent>
				</Message>
			)}

			{/* Tool calls + reasoning section */}
			{(working || hasSteps || hasReasoning) && (
				<div className="space-y-2">
					{/* Summary bar — shown when NOT expanded (completed turns) */}
					{!showToolsExpanded && hasSteps && (
						<button
							type="button"
							onClick={() => setStepsExpanded(true)}
							className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							<ChevronDownIcon className="size-3 -rotate-90" />
							<div className="flex items-center gap-1.5">
								{pills.map((pill) => (
									<ToolPill key={pill.category} pill={pill} />
								))}
							</div>
							<span className="text-muted-foreground/40">{duration}</span>
							{hasErrors && (
								<span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
									errors
								</span>
							)}
						</button>
					)}

					{/* Reasoning blocks — always visible (they have their own collapse) */}
					{!showToolsExpanded && hasReasoning && (
						<div className="space-y-2">
							{orderedParts
								.filter(
									(p): p is Extract<RenderablePart, { kind: "reasoning" }> =>
										p.kind === "reasoning",
								)
								.map((item) => {
									const reasoningText = item.part.text.replace("[REDACTED]", "").trim()
									if (!reasoningText) return null
									const durationSec = item.part.time.end
										? Math.ceil((item.part.time.end - item.part.time.start) / 1000)
										: undefined
									return (
										<Reasoning
											key={item.part.id}
											isStreaming={false}
											duration={durationSec}
											defaultOpen={false}
										>
											<ReasoningTrigger />
											<ReasoningContent>{reasoningText}</ReasoningContent>
										</Reasoning>
									)
								})}
						</div>
					)}

					{/* Collapse button — shown when expanded on completed turns */}
					{showToolsExpanded && !isActiveTurn && hasSteps && (
						<button
							type="button"
							onClick={() => setStepsExpanded(false)}
							className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							<ChevronDownIcon className="size-3" />
							<span className="text-muted-foreground/60">
								{toolParts.length} {toolParts.length === 1 ? "step" : "steps"}
							</span>
							<span className="text-muted-foreground/40">{duration}</span>
						</button>
					)}

					{/* Active turn status line (while working, before tools/reasoning appear) */}
					{working && !hasSteps && !hasReasoning && (
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<Shimmer className="text-xs">{statusText}</Shimmer>
						</div>
					)}

					{/* Hidden parts indicator (compact mode) */}
					{showToolsExpanded && hiddenCount > 0 && (
						<div className="flex items-center gap-1.5 pl-1 text-[11px] text-muted-foreground/50">
							<span>
								+ {hiddenCount} earlier {hiddenCount === 1 ? "step" : "steps"}
							</span>
						</div>
					)}

					{/* Expanded: interleaved text + reasoning + tool calls in natural order */}
					{showToolsExpanded && (
						<div className="space-y-2.5">
							{visibleParts.map((item) => {
								if (item.kind === "tool") {
									return (
										<ChatToolCall key={item.part.id} part={item.part} isActiveTurn={isActiveTurn} />
									)
								}
								if (item.kind === "reasoning") {
									const reasoningText = item.part.text.replace("[REDACTED]", "").trim()
									if (!reasoningText) return null
									const durationSec = item.part.time.end
										? Math.ceil((item.part.time.end - item.part.time.start) / 1000)
										: undefined
									const isReasoningStreaming = !item.part.time.end && working
									return (
										<Reasoning
											key={item.part.id}
											isStreaming={isReasoningStreaming}
											duration={durationSec}
											defaultOpen={isReasoningStreaming ? undefined : false}
										>
											<ReasoningTrigger />
											<ReasoningContent animated={isReasoningStreaming}>
												{reasoningText}
											</ReasoningContent>
										</Reasoning>
									)
								}
								return (
									<div key={item.id} className="py-0.5">
										<Message from="assistant">
											<MessageContent>
												<MessageResponse>{item.text}</MessageResponse>
											</MessageContent>
										</Message>
									</div>
								)
							})}
						</div>
					)}
				</div>
			)}

			{/* Error */}
			{errorText && (
				<div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
					{errorText.length > 300 ? `${errorText.slice(0, 300)}...` : errorText}
				</div>
			)}

			{/* Thinking shimmer — shown when working and no response text yet */}
			{working && !responseText && hasSteps && (
				<div className="py-1">
					<Shimmer className="text-sm">{statusText}</Shimmer>
				</div>
			)}

			{/* Assistant response — shown when not working AND not already rendered inline */}
			{!working && responseText && !textAlreadyInline && (
				<Message from="assistant">
					<MessageContent>
						<MessageResponse>{responseText}</MessageResponse>
					</MessageContent>
					<MessageActions className="opacity-0 transition-opacity group-hover/turn:opacity-100">
						<MessageAction
							tooltip={copied ? "Copied" : "Copy response"}
							onClick={handleCopyResponse}
						>
							{copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
						</MessageAction>
						{onRevertToMessage && (
							<MessageAction tooltip="Undo from here" onClick={handleRevertHere}>
								<Undo2Icon className="size-3" />
							</MessageAction>
						)}
					</MessageActions>
				</Message>
			)}

			{/* Streaming response — visible while working, when text isn't already inline */}
			{working && responseText && !textAlreadyInline && (
				<Message from="assistant">
					<MessageContent>
						<MessageResponse animated>{responseText}</MessageResponse>
					</MessageContent>
				</Message>
			)}
		</div>
	)
})
