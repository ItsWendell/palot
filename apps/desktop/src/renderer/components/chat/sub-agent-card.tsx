import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@codedeck/ui/components/collapsible"
import { cn } from "@codedeck/ui/lib/utils"
import { useNavigate, useParams } from "@tanstack/react-router"
import { ArrowRightIcon, ChevronRightIcon, Loader2Icon, ZapIcon } from "lucide-react"
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react"
import type { Part, ToolPart, ToolState } from "../../lib/types"
import { useAppStore } from "../../stores/app-store"
import {
	getAllStreamingParts,
	getSnapshot as getStreamingSnapshot,
	subscribe as subscribeStreaming,
} from "../../stores/streaming-store"
import { getToolDuration, getToolInfo, getToolSubtitle } from "./chat-tool-call"
import { getToolCategory, TOOL_CATEGORY_COLORS } from "./tool-card"

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
 * Renders a sub-agent (task tool) as a collapsible live activity card.
 *
 * **Header bar** (always visible): chevron, Zap icon, "Agent" label,
 * agent type, truncated task description, live status / duration, Open button.
 *
 * **Collapsible body**: task description, live tool activity rows,
 * latest text snippet, completion/error states.
 *
 * **Auto-collapse**: expanded while running, auto-collapses on completion.
 */
export const SubAgentCard = memo(function SubAgentCard({ part: propPart }: SubAgentCardProps) {
	const navigate = useNavigate()
	const { projectSlug } = useParams({ strict: false }) as { projectSlug?: string }

	// Read the live tool part directly from the store so we always have the
	// latest state (status, metadata, output) even when the parent turn's
	// structural sharing keeps the prop stale.
	const livePart = useAppStore((s) => {
		const parts = s.parts[propPart.messageID]
		if (!parts) return undefined
		return parts.find((p): p is ToolPart => p.id === propPart.id && p.type === "tool")
	})
	const part = livePart ?? propPart

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

	// ── Collapsible state ──────────────────────────────────────
	// Start expanded. Auto-collapse when the agent finishes.
	const [isOpen, setIsOpen] = useState(true)
	const wasRunningRef = useRef(isRunning)

	useEffect(() => {
		// When transitioning from running → completed/error, auto-collapse
		if (wasRunningRef.current && !isRunning) {
			setIsOpen(false)
		}
		wasRunningRef.current = isRunning
	}, [isRunning])

	// ── Duration ───────────────────────────────────────────────
	const duration = getToolDuration(part)

	// Access child session data from the store.
	// Use per-session partsVersion instead of the full s.parts record so we
	// only re-render when the child session's parts change, not every session's.
	const childMessages = useAppStore((s) => (sessionId ? s.messages[sessionId] : undefined))
	const childPartsVersion = useAppStore((s) => (sessionId ? (s.partsVersion[sessionId] ?? 0) : 0))

	// Subscribe to the streaming store so we see text/reasoning updates
	// in real-time during active streaming, not just after flush.
	const streamingVersion = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot)

	// Derive child session's activity
	const { latestToolParts, latestText, childStatus } = useMemo(() => {
		if (!childMessages || childMessages.length === 0) {
			return { latestToolParts: [], latestText: undefined, childStatus: undefined }
		}

		// Read streaming overrides — text/reasoning parts accumulate here
		// at ~50ms cadence before being flushed to the main store.
		// Reference streamingVersion and childPartsVersion so the linter
		// sees them as used and they trigger recomputation.
		void streamingVersion
		void childPartsVersion
		const streaming = getAllStreamingParts()
		const allStoreParts = useAppStore.getState().parts

		const allParts: Part[] = []
		for (const msg of childMessages) {
			const baseParts = allStoreParts[msg.id]
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
	}, [childMessages, childPartsVersion, streamingVersion])

	// Truncate latest text to ~150 chars
	const truncatedText = useMemo(() => {
		if (!latestText) return undefined
		if (latestText.length <= 150) return latestText
		return `${latestText.slice(0, 147)}...`
	}, [latestText])

	return (
		<Collapsible open={isOpen} onOpenChange={setIsOpen}>
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
					<CollapsibleTrigger asChild>
						<button
							type="button"
							className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-colors hover:opacity-80"
						>
							<ChevronRightIcon
								className={cn(
									"size-3 shrink-0 text-muted-foreground/50 transition-transform",
									isOpen && "rotate-90",
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
					</CollapsibleTrigger>
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

				{/* Collapsible body */}
				<CollapsibleContent>
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

					{/* Latest text snippet from sub-agent */}
					{truncatedText && (
						<div className="border-t border-border/30 px-3.5 py-2">
							<p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/70 italic">
								{truncatedText}
							</p>
						</div>
					)}

					{/* Completion / error state */}
					{isCompleted && !latestToolParts.length && !truncatedText && (
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
				</CollapsibleContent>
			</div>
		</Collapsible>
	)
})
