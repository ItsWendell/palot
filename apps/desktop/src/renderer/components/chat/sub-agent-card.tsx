import { MessageResponse } from "@palot/ui/components/ai-elements/message"
import { cn } from "@palot/ui/lib/utils"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import {
	ArrowRightIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ChevronUpIcon,
	Loader2Icon,
	ZapIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { messagesFamily } from "../../atoms/messages"
import { partsFamily } from "../../atoms/parts"
import { appStore } from "../../atoms/store"
import { getAllStreamingParts, streamingVersionAtom } from "../../atoms/streaming"
import type { Part, ToolPart, ToolState } from "../../lib/types"
import { getToolDuration, getToolInfo, getToolSubtitle } from "./chat-tool-call"
import { getToolCategory, TOOL_CATEGORY_COLORS } from "./tool-card"

// ============================================================
// Collapse state for three-tier agent card
// ============================================================

type CollapseState = "closed" | "summary" | "expanded"

/**
 * Extract the first meaningful plain-text line from a markdown string.
 * Strips headings, horizontal rules, bold/italic markers, link syntax,
 * and skips blank/decoration-only lines.
 */
function extractFirstLine(md: string): string | undefined {
	const lines = md.split("\n")
	for (const raw of lines) {
		const line = raw
			.replace(/^#{1,6}\s+/, "") // strip heading markers
			.replace(/^[-*_]{3,}\s*$/, "") // strip horizontal rules
			.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // strip bold/italic
			.replace(/`([^`]+)`/g, "$1") // strip inline code
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // strip links → keep label
			.replace(/^[-*+]\s+/, "") // strip list markers
			.replace(/^\d+\.\s+/, "") // strip ordered list markers
			.trim()
		if (line.length > 0) return line
	}
	return undefined
}

// ============================================================
// Sub-agent status computation (follows into child session)
// ============================================================

function computeSubAgentStatus(parts: Part[]): string {
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

// ============================================================
// SubAgentCard
// ============================================================

interface SubAgentCardProps {
	part: ToolPart
}

/**
 * Renders a sub-agent (task tool) as a three-state collapsible card.
 *
 * **Closed**: Header bar only — chevron, Zap icon, "Agent" label,
 * agent type, truncated task description, live status / duration, Open button.
 *
 * **Summary**: Header + first ~4 lines of the agent's final text as a
 * preview with a "Show more" affordance. No tool rows shown.
 *
 * **Expanded**: Header + task description + tool activity rows + full
 * markdown-rendered agent response.
 *
 * While running the card is fully expanded. On completion it auto-collapses
 * to the summary state (or closed if there's no text).
 */
export const SubAgentCard = memo(function SubAgentCard({ part: propPart }: SubAgentCardProps) {
	const navigate = useNavigate()
	const { projectSlug } = useParams({ strict: false }) as { projectSlug?: string }

	// Read the live tool part directly from the store so we always have the
	// latest state (status, metadata, output) even when the parent turn's
	// structural sharing keeps the prop stale.
	const messageParts = useAtomValue(partsFamily(propPart.messageID))
	const livePart = useMemo(
		() => messageParts?.find((p): p is ToolPart => p.id === propPart.id && p.type === "tool"),
		[messageParts, propPart.id],
	)
	const part = livePart ?? propPart

	// Count how many sibling task tools exist in the same message.
	// When there are parallel sub-agents, we start in "summary" instead of
	// "expanded" to avoid a noisy wall of live tool activity.
	const hasParallelSiblings = useMemo(
		() => (messageParts?.filter((p) => p.type === "tool" && p.tool === "task").length ?? 0) > 1,
		[messageParts],
	)

	// Derive sessionId from the live part's metadata so it becomes available
	// as soon as the server populates it, even if the parent doesn't re-render.
	const sessionId = useMemo(() => {
		if (part.tool !== "task") return undefined
		const state = part.state as ToolState & { metadata?: Record<string, unknown> }
		return (state.metadata?.sessionId as string | undefined) ?? undefined
	}, [part])

	const handleNavigate = useCallback(
		(e: React.MouseEvent) => {
			// Prevent the click from toggling the collapsible
			e.stopPropagation()
			if (sessionId) {
				navigate({
					to: "/project/$projectSlug/session/$sessionId",
					params: {
						projectSlug: projectSlug ?? "unknown",
						sessionId,
					},
				})
			}
		},
		[sessionId, navigate, projectSlug],
	)

	const taskTitle =
		(part.state.input?.description as string) ??
		("title" in part.state ? part.state.title : undefined) ??
		"Sub-agent"
	const agentType = (part.state.input?.subagent_type as string) ?? "general"

	// Determine if the sub-agent is still running
	const isRunning = part.state.status === "running" || part.state.status === "pending"
	const isError = part.state.status === "error"
	const isCompleted = part.state.status === "completed"

	// ── Three-state collapse ───────────────────────────────────
	// "closed"   → header only
	// "summary"  → header + text preview (first ~4 lines)
	// "expanded" → header + tools + full markdown text
	const [collapseState, setCollapseState] = useState<CollapseState>(
		hasParallelSiblings ? "summary" : "expanded",
	)
	const wasRunningRef = useRef(isRunning)

	useEffect(() => {
		// When transitioning from running → completed/error,
		// auto-collapse to "summary" if there's text, otherwise "closed"
		if (wasRunningRef.current && !isRunning) {
			// We defer to next render so latestText is populated
			requestAnimationFrame(() => {
				setCollapseState((prev) => (prev === "expanded" ? "summary" : prev))
			})
		}
		wasRunningRef.current = isRunning
	}, [isRunning])

	const handleHeaderToggle = useCallback(() => {
		setCollapseState((prev) => {
			if (prev === "closed") return isRunning ? "expanded" : "summary"
			// Both "summary" and "expanded" collapse to "closed"
			return "closed"
		})
	}, [isRunning])

	const handleShowMore = useCallback((e: React.MouseEvent) => {
		e.stopPropagation()
		setCollapseState("expanded")
	}, [])

	const handleShowLess = useCallback((e: React.MouseEvent) => {
		e.stopPropagation()
		setCollapseState("summary")
	}, [])

	// ── Duration ───────────────────────────────────────────────
	const duration = getToolDuration(part)

	// Access child session data from the store.
	const childMessages = useAtomValue(messagesFamily(sessionId ?? ""))

	// Subscribe to the streaming version so we see text/reasoning updates
	// in real-time during active streaming, not just after flush.
	const streamingVersion = useAtomValue(streamingVersionAtom)

	// Derive child session's activity
	const { latestToolParts, latestText, childStatus } = useMemo(() => {
		if (!childMessages || childMessages.length === 0) {
			return { latestToolParts: [], latestText: undefined, childStatus: undefined }
		}

		// Read streaming overrides — text/reasoning parts accumulate here
		// at ~50ms cadence before being flushed to the main store.
		// Reference streamingVersion so the linter sees it as used and it triggers recomputation.
		void streamingVersion
		const streaming = getAllStreamingParts()

		const allParts: Part[] = []
		for (const msg of childMessages) {
			const baseParts = appStore.get(partsFamily(msg.id))
			if (baseParts) {
				const overrides = streaming[msg.id]
				for (const p of baseParts) {
					allParts.push(overrides?.[p.id] ?? p)
				}
			}
		}

		// Get the latest tool parts (last 3 for compact display)
		const toolParts: ToolPart[] = []
		for (const p of allParts) {
			if (p.type === "tool" && p.tool !== "todoread") {
				toolParts.push(p)
			}
		}
		const latestToolParts = toolParts.slice(-3)

		// Get the latest text snippet (last text part, truncated)
		let latestText: string | undefined
		for (let i = allParts.length - 1; i >= 0; i--) {
			const p = allParts[i]
			if (p.type === "text" && !p.synthetic && p.text.trim()) {
				latestText = p.text.trim()
				break
			}
		}

		// Compute status by following into child
		const childStatus = computeSubAgentStatus(allParts)

		return { latestToolParts, latestText, childStatus }
	}, [childMessages, streamingVersion])

	// Extract first meaningful line for the summary teaser.
	// "hasMore" is true when the full text has content beyond the first line.
	const firstLine = useMemo(() => extractFirstLine(latestText ?? ""), [latestText])
	const hasMore = useMemo(() => {
		if (!latestText || !firstLine) return false
		// If there's any non-trivial content beyond the first line, we have more
		const rest = latestText.slice(latestText.indexOf(firstLine) + firstLine.length).trim()
		return rest.length > 0
	}, [latestText, firstLine])

	// If there's no text and we're in summary mode, fall back to closed
	// (summary with nothing to show is pointless)
	useEffect(() => {
		if (collapseState === "summary" && !firstLine) {
			setCollapseState("closed")
		}
	}, [collapseState, firstLine])

	const showSummary = collapseState === "summary" || collapseState === "expanded"
	const showExpanded = collapseState === "expanded"

	return (
		<div
			className={cn(
				"overflow-hidden rounded-lg border",
				isRunning
					? "border-violet-500/30 bg-violet-500/[0.02]"
					: isError
						? "border-red-500/30 bg-red-500/[0.02]"
						: "border-border bg-card/50",
			)}
		>
			{/* Header — always visible */}
			<div className="flex items-center gap-2.5 px-3.5 py-2.5">
				{/* Clickable area toggles collapse */}
				<button
					type="button"
					onClick={handleHeaderToggle}
					className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-colors hover:opacity-80"
				>
					<ChevronRightIcon
						className={cn(
							"size-3 shrink-0 text-muted-foreground/50 transition-transform",
							collapseState !== "closed" && "rotate-90",
						)}
					/>
					<ZapIcon
						className={cn(
							"size-3.5 shrink-0",
							isRunning ? "text-violet-400 animate-pulse" : "text-muted-foreground",
						)}
					/>
					<span className="text-xs font-medium text-foreground/80">Agent</span>
					<span className="shrink-0 text-xs text-muted-foreground/60">({agentType})</span>
					{/* Truncated task title in header */}
					<span className="min-w-0 truncate text-xs text-muted-foreground/50">{taskTitle}</span>
				</button>
				{/* Right side: status / duration / open button — outside trigger */}
				<div className="flex shrink-0 items-center gap-2.5">
					{isRunning && childStatus && (
						<span className="text-[11px] text-muted-foreground/60">{childStatus}</span>
					)}
					{isRunning && <Loader2Icon className="size-3 animate-spin text-muted-foreground/40" />}
					{!isRunning && duration && (
						<span className="text-[11px] text-muted-foreground/40">{duration}</span>
					)}
					{sessionId && (
						<button
							type="button"
							onClick={handleNavigate}
							className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
						>
							Open
							<ArrowRightIcon className="size-3" />
						</button>
					)}
				</div>
			</div>

			{/* ── Summary state: single-line teaser ────────────────── */}
			{showSummary && !showExpanded && firstLine && (
				<div className="flex items-baseline gap-2 border-t border-border/30 px-3.5 py-2">
					<p className="min-w-0 flex-1 truncate text-[11px] leading-relaxed text-muted-foreground/70 italic">
						{firstLine}
					</p>
					{hasMore && (
						<button
							type="button"
							onClick={handleShowMore}
							className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-primary/70 transition-colors hover:text-primary"
						>
							Show more
							<ChevronDownIcon className="size-3" />
						</button>
					)}
				</div>
			)}

			{/* ── Expanded state: full content ────────────────────── */}
			{showExpanded && (
				<>
					{/* Task description */}
					<div className="border-t border-border/50 px-3.5 py-2">
						<p className="text-xs text-muted-foreground">{taskTitle}</p>
					</div>

					{/* Live activity: latest tool calls */}
					{latestToolParts.length > 0 && (
						<div className="border-t border-border/30 px-3.5 py-2">
							<div className="space-y-1">
								{latestToolParts.map((tp) => {
									const { icon: TpIcon, title } = getToolInfo(tp.tool)
									const tpSubtitle = getToolSubtitle(tp)
									const category = getToolCategory(tp.tool)
									const borderColor = TOOL_CATEGORY_COLORS[category]
									const tpRunning = tp.state.status === "running" || tp.state.status === "pending"
									const tpError = tp.state.status === "error"

									return (
										<div
											key={tp.id}
											className={cn(
												"flex items-center gap-2 rounded border-l-2 px-2.5 py-1 text-[11px]",
												borderColor,
											)}
										>
											<TpIcon
												className={cn(
													"size-3 shrink-0",
													tpError
														? "text-red-400"
														: tpRunning
															? "text-muted-foreground animate-pulse"
															: "text-muted-foreground/60",
												)}
											/>
											<span
												className={cn(
													"font-medium",
													tpError ? "text-red-400" : "text-foreground/70",
												)}
											>
												{title}
											</span>
											{tpSubtitle && (
												<span className="min-w-0 truncate text-muted-foreground/50">
													{tpSubtitle}
												</span>
											)}
										</div>
									)
								})}
							</div>
						</div>
					)}

					{/* Full agent response rendered as markdown */}
					{latestText && (
						<div className="border-t border-border/30 px-3.5 py-2.5">
							<div className="max-h-96 overflow-y-auto text-xs text-muted-foreground">
								<MessageResponse
									animated={isRunning}
									className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_li]:text-xs [&_p]:text-xs [&_p]:my-1 [&_pre]:max-h-40 [&_pre]:text-[11px]"
								>
									{latestText}
								</MessageResponse>
							</div>
							{hasMore && (
								<button
									type="button"
									onClick={handleShowLess}
									className="mt-2 inline-flex items-center gap-0.5 text-[10px] font-medium text-primary/70 transition-colors hover:text-primary"
								>
									Show less
									<ChevronUpIcon className="size-3" />
								</button>
							)}
						</div>
					)}

					{/* Completion / error state */}
					{isCompleted && !latestToolParts.length && !latestText && (
						<div className="border-t border-border/30 px-3.5 py-2">
							<span className="text-[11px] text-muted-foreground/50">Completed</span>
						</div>
					)}
					{isError && (
						<div className="border-t border-red-500/20 bg-red-500/5 px-3.5 py-2">
							<span className="text-[11px] text-red-400">
								{part.state.status === "error" ? part.state.error : "Sub-agent failed"}
							</span>
						</div>
					)}
				</>
			)}

			{/* Error shown in summary state too (not just expanded) */}
			{showSummary && !showExpanded && isError && (
				<div className="border-t border-red-500/20 bg-red-500/5 px-3.5 py-2">
					<span className="text-[11px] text-red-400">
						{part.state.status === "error" ? part.state.error : "Sub-agent failed"}
					</span>
				</div>
			)}
		</div>
	)
})
