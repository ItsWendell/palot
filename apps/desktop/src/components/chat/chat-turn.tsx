import {
	Message,
	MessageAction,
	MessageActions,
	MessageContent,
	MessageResponse,
} from "@codedeck/ui/components/ai-elements/message"
import { CheckIcon, ChevronDownIcon, CopyIcon, Loader2Icon } from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import type {
	ChatMessageEntry,
	ChatPart,
	ChatTurn as ChatTurnType,
} from "../../hooks/use-session-chat"
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
 * Follows OpenCode's computeStatusFromPart pattern.
 */
function computeStatus(parts: ChatPart[]): string {
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
 * Extracts the user message text from parts.
 */
function getUserText(entry: ChatMessageEntry): string {
	return entry.parts
		.filter((p) => p.type === "text" && p.text)
		.map((p) => p.text!)
		.join("\n")
}

/**
 * Extracts the final response text from assistant messages.
 * Follows OpenCode's pattern: find the last text part across all assistant messages.
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
function getToolParts(assistantMessages: ChatMessageEntry[]): ChatPart[] {
	const tools: ChatPart[] = []
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
		const error = msg.info.error?.data?.message
		if (error) return typeof error === "string" ? error : String(error)
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
 * Follows OpenCode's SessionTurn pattern:
 * - User message (sticky-ish at top)
 * - Collapsible steps trigger with status
 * - Tool call details (when expanded)
 * - Final response (always visible)
 */
export const ChatTurnComponent = memo(function ChatTurnComponent({
	turn,
	isLast,
	isWorking,
}: ChatTurnProps) {
	const [stepsExpanded, setStepsExpanded] = useState(false)
	const [copied, setCopied] = useState(false)

	const userText = useMemo(() => getUserText(turn.userMessage), [turn.userMessage])
	const { text: responseText } = useMemo(
		() => getResponseText(turn.assistantMessages),
		[turn.assistantMessages],
	)
	const toolParts = useMemo(() => getToolParts(turn.assistantMessages), [turn.assistantMessages])
	const errorText = useMemo(() => getError(turn.assistantMessages), [turn.assistantMessages])

	const allAssistantParts = useMemo(
		() => turn.assistantMessages.flatMap((m) => m.parts),
		[turn.assistantMessages],
	)
	const statusText = useMemo(() => computeStatus(allAssistantParts), [allAssistantParts])

	const working = isLast && isWorking
	const hasSteps = toolParts.length > 0
	const lastAssistant = turn.assistantMessages.at(-1)
	const duration = useMemo(() => {
		return computeDuration(turn.userMessage.info.time.created, lastAssistant?.info.time?.completed)
	}, [turn.userMessage.info.time.created, lastAssistant?.info.time?.completed])

	const handleCopyResponse = useCallback(async () => {
		if (!responseText) return
		await navigator.clipboard.writeText(responseText)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [responseText])

	return (
		<div className="group/turn space-y-3">
			{/* User message */}
			<Message from="user">
				<MessageContent>
					{userText.length > 300 ? <ExpandableText text={userText} /> : <p>{userText}</p>}
				</MessageContent>
			</Message>

			{/* Steps trigger + tool calls — keep custom */}
			{(working || hasSteps) && (
				<div className="mb-3">
					{/* Collapsible trigger — like OpenCode's step trigger */}
					<button
						type="button"
						onClick={() => setStepsExpanded((prev) => !prev)}
						className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
					>
						{working ? (
							<Loader2Icon className="size-3 animate-spin" />
						) : (
							<ChevronDownIcon
								className={`size-3 transition-transform ${stepsExpanded ? "" : "-rotate-90"}`}
							/>
						)}
						<span>{working ? statusText : stepsExpanded ? "Hide steps" : "Show steps"}</span>
						<span className="text-muted-foreground/60">&middot;</span>
						<span>{duration}</span>
					</button>

					{/* Expanded tool calls */}
					{(stepsExpanded || working) && (
						<div className="mt-1 ml-1 border-l border-border pl-2.5 space-y-0.5">
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

/**
 * Expandable user message text — follows OpenCode's pattern
 * of max-height constraint with gradient fade and expand button.
 */
function ExpandableText({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false)

	return (
		<div className="relative">
			<div className={`overflow-hidden ${expanded ? "" : "max-h-16"}`}>
				<MessageResponse>{text}</MessageResponse>
			</div>
			{!expanded && (
				<div className="absolute inset-x-0 bottom-0 flex items-end justify-center bg-gradient-to-t from-background to-transparent pt-6 pb-0">
					<button
						type="button"
						onClick={() => setExpanded(true)}
						className="text-[11px] text-muted-foreground hover:text-foreground"
					>
						Show more
					</button>
				</div>
			)}
		</div>
	)
}
