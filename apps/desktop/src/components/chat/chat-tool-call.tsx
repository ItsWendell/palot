import {
	Plan,
	PlanAction,
	PlanContent,
	PlanHeader,
	PlanTitle,
	PlanTrigger,
} from "@codedeck/ui/components/ai-elements/plan"
import { useNavigate, useParams } from "@tanstack/react-router"
import {
	ArrowRightIcon,
	BookOpenIcon,
	CodeIcon,
	EditIcon,
	EyeIcon,
	FileCodeIcon,
	GlobeIcon,
	SearchIcon,
	SquareCheckIcon,
	TerminalIcon,
	WrenchIcon,
	ZapIcon,
} from "lucide-react"
import { memo, useCallback } from "react"
import type { ToolPart } from "../../lib/types"

/**
 * Tool info resolver — maps tool names to icon + display title.
 */
function getToolInfo(tool: string): {
	icon: typeof WrenchIcon
	title: string
} {
	switch (tool) {
		case "read":
			return { icon: EyeIcon, title: "Read" }
		case "glob":
			return { icon: SearchIcon, title: "Glob" }
		case "grep":
			return { icon: SearchIcon, title: "Grep" }
		case "list":
			return { icon: SearchIcon, title: "List" }
		case "webfetch":
			return { icon: GlobeIcon, title: "Fetch" }
		case "bash":
			return { icon: TerminalIcon, title: "Shell" }
		case "edit":
			return { icon: EditIcon, title: "Edit" }
		case "write":
			return { icon: FileCodeIcon, title: "Write" }
		case "apply_patch":
			return { icon: CodeIcon, title: "Patch" }
		case "task":
			return { icon: ZapIcon, title: "Agent" }
		case "todowrite":
			return { icon: SquareCheckIcon, title: "Todos" }
		case "todoread":
			return { icon: SquareCheckIcon, title: "Todos" }
		case "question":
			return { icon: BookOpenIcon, title: "Questions" }
		default:
			return { icon: WrenchIcon, title: tool }
	}
}

/**
 * Extracts a human-readable subtitle from tool state.
 */
function getToolSubtitle(part: ToolPart): string | undefined {
	const state = part.state
	const input = state.input
	const title = "title" in state ? state.title : undefined

	switch (part.tool) {
		case "read":
			return shortenPath((input.filePath as string) ?? (input.path as string))
		case "glob":
			return (input.pattern as string) ?? (input.path as string)
		case "grep":
			return (input.pattern as string) ?? (input.path as string)
		case "bash":
			return title ?? (input.command as string)
		case "edit":
			return shortenPath((input.filePath as string) ?? (input.path as string))
		case "write":
			return shortenPath((input.filePath as string) ?? (input.path as string))
		case "apply_patch":
			return title
		case "webfetch":
			return input.url as string
		case "task":
			return (input.description as string) ?? title
		case "todowrite":
		case "todoread":
			return title
		default:
			return title
	}
}

/** Shorten a file path to just filename or last 2 segments */
function shortenPath(path: string | undefined): string | undefined {
	if (!path) return undefined
	const parts = path.split("/")
	if (parts.length <= 2) return path
	return parts.slice(-2).join("/")
}

/**
 * Maps SDK ToolPart status to AI Elements state.
 */
function mapToolState(
	part: ToolPart,
): "input-streaming" | "input-available" | "output-available" | "output-error" {
	const status = part.state.status
	if (status === "running" || status === "pending") return "input-available"
	if (status === "error") return "output-error"
	if (status === "completed") return "output-available"
	return "input-streaming"
}

interface ChatToolCallProps {
	part: ToolPart
	defaultOpen?: boolean
}

/**
 * Compact inline tool call rendering — Codex-style.
 * Shows tool name + context as a single line.
 * Expandable on click to show input/output detail.
 */
export const ChatToolCall = memo(function ChatToolCall({
	part,
	defaultOpen = false,
}: ChatToolCallProps) {
	const navigate = useNavigate()
	const { projectSlug } = useParams({ strict: false }) as {
		projectSlug?: string
	}

	const toolName = part.tool

	// Sub-agent navigation: extract sessionId from task tool metadata
	const subAgentSessionId =
		part.tool === "task" && "metadata" in part.state
			? (part.state.metadata?.sessionId as string | undefined)
			: undefined

	const handleNavigate = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			if (subAgentSessionId) {
				navigate({
					to: "/project/$projectSlug/session/$sessionId",
					params: {
						projectSlug: projectSlug ?? "unknown",
						sessionId: subAgentSessionId,
					},
				})
			}
		},
		[subAgentSessionId, navigate, projectSlug],
	)

	// Skip rendering todoread parts without output
	if (part.tool === "todoread" && part.state.status !== "completed") return null

	// --- Task tool: sub-agent — compact inline ---
	if (part.tool === "task") {
		const taskTitle =
			(part.state.input?.description as string) ??
			("title" in part.state ? part.state.title : undefined) ??
			"Sub-agent"

		return (
			<div className="flex items-center gap-2 py-0.5">
				<ZapIcon className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="truncate text-sm text-muted-foreground">{taskTitle}</span>
				{subAgentSessionId && (
					<button
						type="button"
						onClick={handleNavigate}
						className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
					>
						Open
						<ArrowRightIcon className="size-3" />
					</button>
				)}
			</div>
		)
	}

	// --- Todo tools: plan (keep expandable) ---
	if (part.tool === "todowrite" || part.tool === "todoread") {
		const todos =
			(part.state.input?.todos as Array<{ content: string; status: string }> | undefined) ?? []
		const isStreaming = mapToolState(part) === "input-streaming"
		const todoTitle = "title" in part.state ? part.state.title : undefined

		return (
			<Plan defaultOpen={defaultOpen || todos.length > 0} isStreaming={isStreaming}>
				<PlanHeader>
					<PlanTitle>{todoTitle ?? "Plan"}</PlanTitle>
					<PlanAction>
						<PlanTrigger />
					</PlanAction>
				</PlanHeader>
				{todos.length > 0 && (
					<PlanContent>
						<div className="space-y-1">
							{todos.map((todo, i) => (
								<div
									key={`todo-${todo.content.slice(0, 20)}-${i}`}
									className="flex items-start gap-2 text-xs"
								>
									<span className="mt-0.5">
										{todo.status === "completed" ? (
											<SquareCheckIcon className="size-3.5 text-green-500" />
										) : (
											<span className="inline-block size-3.5 rounded-sm border border-border" />
										)}
									</span>
									<span
										className={
											todo.status === "completed"
												? "text-muted-foreground line-through"
												: "text-foreground"
										}
									>
										{todo.content}
									</span>
								</div>
							))}
						</div>
					</PlanContent>
				)}
			</Plan>
		)
	}

	// --- All other tools: compact inline ---
	const { icon: Icon, title } = getToolInfo(toolName)
	const subtitle = getToolSubtitle(part)
	const state = mapToolState(part)
	const isError = state === "output-error"
	const isRunning = state === "input-available" || state === "input-streaming"

	return (
		<div className="flex items-center gap-2 py-0.5">
			<Icon
				className={`size-3.5 shrink-0 ${
					isError
						? "text-red-400"
						: isRunning
							? "text-muted-foreground animate-pulse"
							: "text-muted-foreground"
				}`}
			/>
			<span className={`truncate text-sm ${isError ? "text-red-400" : "text-muted-foreground"}`}>
				{title}
				{subtitle && (
					<>
						{" "}
						<span className="text-muted-foreground/60">{subtitle}</span>
					</>
				)}
			</span>
		</div>
	)
})
