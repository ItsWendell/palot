import {
	Message,
	MessageAction,
	MessageActions,
	MessageContent,
	MessageResponse,
} from "@codedeck/ui/components/ai-elements/message"
import { Shimmer } from "@codedeck/ui/components/ai-elements/shimmer"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@codedeck/ui/components/dialog"
import {
	BotIcon,
	CheckIcon,
	ChevronDownIcon,
	CopyIcon,
	FileIcon,
	ListOrderedIcon,
} from "lucide-react"
import { memo, useCallback, useDeferredValue, useMemo, useState } from "react"
import type { ChatMessageEntry, ChatTurn as ChatTurnType } from "../../hooks/use-session-chat"
import type { FilePart, Part, TextPart, ToolPart } from "../../lib/types"
import { ChatToolCall } from "./chat-tool-call"

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

/**
 * Computes a status string from the last active part.
 */
function computeStatus(parts: Part[]): string {
	for (let i = parts.length - 1; i >= 0; i--) {
		const part = parts[i]
		if (part.type === "tool") {
			switch (part.tool) {
				case "task":
					return "Delegating..."
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

/**
 * Generates a compact summary of tool calls, e.g., "Explored 3 files"
 */
function getToolSummary(toolParts: ToolPart[]): string {
	if (toolParts.length === 0) return ""

	const counts: Record<string, number> = {}
	for (const part of toolParts) {
		const tool = part.tool
		// Group related tools
		if (tool === "read" || tool === "glob" || tool === "grep" || tool === "list") {
			counts.explored = (counts.explored ?? 0) + 1
		} else if (tool === "edit" || tool === "write" || tool === "apply_patch") {
			counts.edited = (counts.edited ?? 0) + 1
		} else if (tool === "bash") {
			counts.ran = (counts.ran ?? 0) + 1
		} else if (tool === "task") {
			counts.delegated = (counts.delegated ?? 0) + 1
		} else if (tool === "webfetch") {
			counts.fetched = (counts.fetched ?? 0) + 1
		} else if (tool === "todowrite" || tool === "todoread") {
			// skip — rendered separately
		} else if (tool === "question") {
			counts.asked = (counts.asked ?? 0) + 1
		} else {
			counts.used = (counts.used ?? 0) + 1
		}
	}

	const parts: string[] = []
	if (counts.explored)
		parts.push(`Explored ${counts.explored} ${counts.explored === 1 ? "file" : "files"}`)
	if (counts.edited) parts.push(`Edited ${counts.edited} ${counts.edited === 1 ? "file" : "files"}`)
	if (counts.ran) parts.push(`Ran ${counts.ran} ${counts.ran === 1 ? "command" : "commands"}`)
	if (counts.delegated)
		parts.push(`Delegated ${counts.delegated} ${counts.delegated === 1 ? "task" : "tasks"}`)
	if (counts.fetched)
		parts.push(`Fetched ${counts.fetched} ${counts.fetched === 1 ? "page" : "pages"}`)
	if (counts.asked)
		parts.push(`Asked ${counts.asked} ${counts.asked === 1 ? "question" : "questions"}`)
	if (counts.used) parts.push(`Used ${counts.used} ${counts.used === 1 ? "tool" : "tools"}`)

	return parts.join(", ")
}

/**
 * Checks if a user message is entirely synthetic (all text parts are synthetic).
 * Synthetic messages are injected by the system (e.g. compaction continuation,
 * shell command framing, plan mode switches) and not authored by the user.
 */
function isSyntheticMessage(entry: ChatMessageEntry): boolean {
	const textParts = entry.parts.filter((p): p is TextPart => p.type === "text")
	return textParts.length > 0 && textParts.every((p) => p.synthetic === true)
}

/**
 * Extracts the user message text from parts, excluding synthetic parts.
 */
function getUserText(entry: ChatMessageEntry): string {
	return entry.parts
		.filter((p): p is TextPart => p.type === "text" && !p.synthetic)
		.map((p) => p.text)
		.join("\n")
}

/**
 * Gets a display label for a synthetic user message based on its content.
 */
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
	return "Auto-continued"
}

/**
 * Extracts file parts (images, PDFs) from a message entry.
 */
function getFileParts(entry: ChatMessageEntry): FilePart[] {
	return entry.parts.filter(
		(p): p is FilePart =>
			p.type === "file" && (p.mime.startsWith("image/") || p.mime === "application/pdf"),
	)
}

/**
 * Renders a grid of image/file attachment thumbnails with click-to-preview.
 */
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

/**
 * Single attachment thumbnail with dialog preview on click.
 */
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

/**
 * Extracts the final response text from assistant messages.
 */
function getResponseText(assistantMessages: ChatMessageEntry[]): {
	text: string | undefined
	partId: string | undefined
} {
	for (let mi = assistantMessages.length - 1; mi >= 0; mi--) {
		const parts = assistantMessages[mi].parts
		for (let pi = parts.length - 1; pi >= 0; pi--) {
			const part = parts[pi]
			if (part.type === "text" && part.text) {
				return { text: part.text, partId: part.id }
			}
		}
	}
	return { text: undefined, partId: undefined }
}

/**
 * Collects all tool parts across assistant messages.
 */
function getToolParts(assistantMessages: ChatMessageEntry[]): ToolPart[] {
	const tools: ToolPart[] = []
	for (const msg of assistantMessages) {
		for (const part of msg.parts) {
			if (part.type === "tool") {
				tools.push(part)
			}
		}
	}
	return tools
}

/**
 * Gets error from assistant messages.
 */
function getError(assistantMessages: ChatMessageEntry[]): string | undefined {
	for (const msg of assistantMessages) {
		if (msg.info.role === "assistant" && msg.info.error) {
			const errorData = msg.info.error.data
			const message = "message" in errorData ? errorData.message : undefined
			if (message) return typeof message === "string" ? message : String(message)
		}
	}
	return undefined
}

interface ChatTurnProps {
	turn: ChatTurnType
	isLast: boolean
	isWorking: boolean
}

/**
 * Renders a single turn: user message + assistant response.
 * Codex-inspired layout:
 * - User message
 * - Compact tool summary ("Explored 3 files") with expand toggle
 * - Thinking shimmer when working
 * - Final response
 */
export const ChatTurnComponent = memo(function ChatTurnComponent({
	turn,
	isLast,
	isWorking,
}: ChatTurnProps) {
	const [stepsExpanded, setStepsExpanded] = useState(false)
	const [copied, setCopied] = useState(false)

	const isSynthetic = useMemo(() => isSyntheticMessage(turn.userMessage), [turn.userMessage])
	const userText = useMemo(() => getUserText(turn.userMessage), [turn.userMessage])
	const syntheticLabel = useMemo(
		() => (isSynthetic ? getSyntheticLabel(turn.userMessage) : ""),
		[isSynthetic, turn.userMessage],
	)
	const userFiles = useMemo(() => getFileParts(turn.userMessage), [turn.userMessage])
	const { text: rawResponseText } = useMemo(
		() => getResponseText(turn.assistantMessages),
		[turn.assistantMessages],
	)
	// Defer the streaming text so React can interrupt long markdown re-renders
	// for higher-priority updates (input handling, scroll, layout).
	// When not streaming (isLast && isWorking is false), the value passes through immediately.
	const responseText = useDeferredValue(rawResponseText)
	const toolParts = useMemo(() => getToolParts(turn.assistantMessages), [turn.assistantMessages])
	const errorText = useMemo(() => getError(turn.assistantMessages), [turn.assistantMessages])

	const allAssistantParts = useMemo(
		() => turn.assistantMessages.flatMap((m) => m.parts),
		[turn.assistantMessages],
	)
	const statusText = useMemo(() => computeStatus(allAssistantParts), [allAssistantParts])
	const toolSummary = useMemo(() => getToolSummary(toolParts), [toolParts])

	const working = isLast && isWorking
	// A turn is "queued" if the session is working but this turn has no assistant
	// response yet AND it's not the turn currently being worked on (isLast).
	// This means the user sent a follow-up while the AI was busy with a previous turn.
	const isQueued = isWorking && turn.assistantMessages.length === 0 && !isLast
	// Also show queued state for the last turn if it has no assistant messages
	// and the session is working (the message was just sent as a steering message)
	const isQueuedLast = isWorking && turn.assistantMessages.length === 0 && isLast
	const hasSteps = toolParts.length > 0
	const lastAssistant = turn.assistantMessages.at(-1)
	const duration = useMemo(() => {
		const lastInfo = lastAssistant?.info
		const completed = lastInfo?.role === "assistant" ? lastInfo.time.completed : undefined
		return computeDuration(turn.userMessage.info.time.created, completed)
	}, [turn.userMessage.info.time.created, lastAssistant?.info])

	const handleCopyResponse = useCallback(async () => {
		if (!responseText) return
		await navigator.clipboard.writeText(responseText)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [responseText])

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
						<p>{userText}</p>
						{(isQueued || isQueuedLast) && (
							<span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/60">
								<ListOrderedIcon className="size-3" />
								Queued
							</span>
						)}
					</MessageContent>
				</Message>
			)}

			{/* Compact tool summary — Codex-style */}
			{(working || hasSteps) && (
				<div className="space-y-1">
					{/* Summary line */}
					<button
						type="button"
						onClick={() => setStepsExpanded((prev) => !prev)}
						className="flex items-center gap-1.5 text-xs text-green-400/80 transition-colors hover:text-green-400"
					>
						<ChevronDownIcon
							className={`size-3 transition-transform ${stepsExpanded ? "" : "-rotate-90"}`}
						/>
						{working ? (
							<span className="text-muted-foreground">{statusText}</span>
						) : (
							<span>{toolSummary || `${toolParts.length} steps`}</span>
						)}
						{!working && <span className="text-muted-foreground/50">{duration}</span>}
					</button>

					{/* Expanded — individual tool calls */}
					{stepsExpanded && (
						<div className="ml-1 space-y-0.5 border-l border-border pl-3">
							{toolParts.map((part) => (
								<ChatToolCall key={part.id} part={part} defaultOpen={part.tool === "todowrite"} />
							))}
						</div>
					)}
				</div>
			)}

			{/* Error */}
			{errorText && !stepsExpanded && (
				<div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
					{errorText.length > 300 ? `${errorText.slice(0, 300)}...` : errorText}
				</div>
			)}

			{/* Thinking shimmer — shown when working and no response text yet */}
			{working && !responseText && (
				<div className="py-1">
					<Shimmer className="text-sm">{statusText}</Shimmer>
				</div>
			)}

			{/* Assistant response — always visible when not working */}
			{!working && responseText && (
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
					</MessageActions>
				</Message>
			)}

			{/* Streaming response — visible while working */}
			{working && responseText && (
				<Message from="assistant">
					<MessageContent>
						<MessageResponse>{responseText}</MessageResponse>
					</MessageContent>
				</Message>
			)}
		</div>
	)
})
