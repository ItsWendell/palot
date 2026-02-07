import {
	Plan,
	PlanAction,
	PlanContent,
	PlanHeader,
	PlanTitle,
	PlanTrigger,
} from "@codedeck/ui/components/ai-elements/plan"
import { Task, TaskContent, TaskItem, TaskTrigger } from "@codedeck/ui/components/ai-elements/task"
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
} from "@codedeck/ui/components/ai-elements/tool"
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
import type { ChatPart } from "../../hooks/use-session-chat"

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
function getToolSubtitle(part: ChatPart): string | undefined {
	const input = part.state?.input
	if (!input) return part.state?.title

	switch (part.tool) {
		case "read":
			return (input.filePath as string) ?? (input.path as string)
		case "glob":
			return (input.pattern as string) ?? (input.path as string)
		case "grep":
			return (input.pattern as string) ?? (input.path as string)
		case "bash":
			return part.state?.title ?? (input.command as string)
		case "edit":
			return (input.filePath as string) ?? (input.path as string)
		case "write":
			return (input.filePath as string) ?? (input.path as string)
		case "apply_patch":
			return part.state?.title
		case "webfetch":
			return input.url as string
		case "task":
			return (input.description as string) ?? part.state?.title
		case "todowrite":
		case "todoread":
			return part.state?.title
		default:
			return part.state?.title
	}
}

/**
 * Maps our ChatPart status to AI Elements ToolPart state.
 */
function mapToolState(
	part: ChatPart,
): "input-streaming" | "input-available" | "output-available" | "output-error" {
	const status = part.state?.status
	if (status === "running" || status === "pending") return "input-available"
	if (status === "error") return "output-error"
	if (part.state?.output || status === "completed") return "output-available"
	return "input-streaming"
}

interface ChatToolCallProps {
	part: ChatPart
	defaultOpen?: boolean
}

/**
 * Renders a tool call using AI Elements Tool, Task, or Plan components.
 */
export const ChatToolCall = memo(function ChatToolCall({
	part,
	defaultOpen = false,
}: ChatToolCallProps) {
	const navigate = useNavigate()
	const { projectSlug } = useParams({ strict: false }) as {
		projectSlug?: string
	}

	const toolName = part.tool ?? "unknown"

	// Sub-agent navigation: extract sessionId from task tool metadata
	const subAgentSessionId =
		part.tool === "task" ? (part.state?.metadata?.sessionId as string | undefined) : undefined

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
	if (part.tool === "todoread" && !part.state?.output) return null

	// --- Task tool: sub-agent ---
	if (part.tool === "task") {
		const taskTitle = (part.state?.input?.description as string) ?? part.state?.title ?? "Sub-agent"

		return (
			<Task defaultOpen={defaultOpen}>
				<TaskTrigger title={taskTitle}>
					<div className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
						<ZapIcon className="size-4" />
						<p className="flex-1 truncate text-sm">{taskTitle}</p>
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
				</TaskTrigger>
				<TaskContent>
					{part.state?.output && (
						<TaskItem>
							{part.state.output.length > 500
								? `${part.state.output.slice(0, 500)}...`
								: part.state.output}
						</TaskItem>
					)}
				</TaskContent>
			</Task>
		)
	}

	// --- Todo tools: plan ---
	if (part.tool === "todowrite" || part.tool === "todoread") {
		const todos =
			(part.state?.input?.todos as Array<{ content: string; status: string }> | undefined) ?? []
		const isStreaming = mapToolState(part) === "input-streaming"

		return (
			<Plan defaultOpen={defaultOpen || todos.length > 0} isStreaming={isStreaming}>
				<PlanHeader>
					<PlanTitle>{part.state?.title ?? "Plan"}</PlanTitle>
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

	// --- All other tools ---
	const { title } = getToolInfo(toolName)
	const subtitle = getToolSubtitle(part)
	const state = mapToolState(part)
	const toolTitle = subtitle ? `${title}: ${subtitle}` : title

	return (
		<Tool defaultOpen={defaultOpen}>
			<ToolHeader type="tool-invocation" state={state} title={toolTitle} />
			<ToolContent>
				{part.tool === "bash" ? (
					<BashToolContent part={part} />
				) : (
					<>
						{part.state?.input && <ToolInput input={part.state.input} />}
						<ToolOutput output={part.state?.output} errorText={part.state?.error} />
					</>
				)}
			</ToolContent>
		</Tool>
	)
})

/**
 * Bash tool content: shows command + output as a preformatted block.
 */
function BashToolContent({ part }: { part: ChatPart }) {
	const command = (part.state?.input?.command as string) ?? ""
	const output = part.state?.output ?? ""
	const error = part.state?.error

	if (error) {
		return (
			<ToolOutput
				output={undefined}
				errorText={error.length > 500 ? `${error.slice(0, 500)}...` : error}
			/>
		)
	}

	const formatted = command ? `$ ${command}\n\n${output}` : output
	const display =
		formatted.length > 2000 ? `${formatted.slice(0, 2000)}\n... (truncated)` : formatted

	return (
		<div data-scrollable className="max-h-[300px] overflow-auto rounded-md bg-muted/50 p-3">
			<pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{display}</pre>
		</div>
	)
}
