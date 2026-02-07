import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@codedeck/ui/components/collapsible"
import {
	ArrowRightIcon,
	BookOpenIcon,
	ChevronRightIcon,
	CodeIcon,
	EditIcon,
	EyeIcon,
	FileCodeIcon,
	GlobeIcon,
	Loader2Icon,
	SearchIcon,
	SquareCheckIcon,
	TerminalIcon,
	WrenchIcon,
	ZapIcon,
} from "lucide-react"
import { memo, useCallback, useState } from "react"
import type { ChatPart } from "../../hooks/use-session-chat"
import { ChatMarkdown } from "./chat-markdown"

/**
 * Tool info resolver — maps tool names to icon + display title.
 * Follows OpenCode's getToolInfo pattern.
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
 * Follows OpenCode's per-tool subtitle extraction.
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
 * Renders the expanded content for a tool call.
 */
function ToolContent({ part }: { part: ChatPart }) {
	const output = part.state?.output
	const error = part.state?.error
	const status = part.state?.status

	if (status === "error" && error) {
		return (
			<div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
				{error.length > 500 ? `${error.slice(0, 500)}...` : error}
			</div>
		)
	}

	if (!output) return null

	// For shell commands, render as code block
	if (part.tool === "bash") {
		const command = (part.state?.input?.command as string) ?? ""
		const formatted = command ? `$ ${command}\n\n${output}` : output
		return (
			<div data-scrollable className="max-h-[300px] overflow-auto rounded-md bg-muted/50 p-3">
				<pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
					{formatted.length > 2000 ? `${formatted.slice(0, 2000)}\n... (truncated)` : formatted}
				</pre>
			</div>
		)
	}

	// For todowrite, render as checkbox list
	if (part.tool === "todowrite" || part.tool === "todoread") {
		const input = part.state?.input
		const todos = (input?.todos as Array<{ content: string; status: string }>) ?? []
		if (todos.length > 0) {
			return (
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
			)
		}
	}

	// Default: render output as markdown (truncated if very long)
	const displayOutput =
		output.length > 3000 ? `${output.slice(0, 3000)}\n\n... (truncated)` : output
	return (
		<div data-scrollable className="max-h-[300px] overflow-auto">
			<ChatMarkdown text={displayOutput} />
		</div>
	)
}

interface ChatToolCallProps {
	part: ChatPart
	defaultOpen?: boolean
	onNavigateToSession?: (sessionId: string) => void
}

/**
 * Collapsible tool call component.
 * Inspired by OpenCode's BasicTool: shows icon + title + subtitle in trigger,
 * with expandable content showing tool output.
 */
export const ChatToolCall = memo(function ChatToolCall({
	part,
	defaultOpen = false,
	onNavigateToSession,
}: ChatToolCallProps) {
	const [open, setOpen] = useState(defaultOpen)
	const toolName = part.tool ?? "unknown"
	const { icon: ToolIcon, title } = getToolInfo(toolName)
	const subtitle = getToolSubtitle(part)
	const status = part.state?.status
	const isRunning = status === "running" || status === "pending"
	const isError = status === "error"
	const hasContent = !!(
		part.state?.output ||
		part.state?.error ||
		(part.tool === "todowrite" && part.state?.input?.todos)
	)

	// Sub-agent navigation: extract sessionId from task tool metadata
	const subAgentSessionId =
		part.tool === "task" ? (part.state?.metadata?.sessionId as string | undefined) : undefined
	const canNavigate = !!subAgentSessionId && !!onNavigateToSession

	const handleNavigate = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			if (subAgentSessionId && onNavigateToSession) {
				onNavigateToSession(subAgentSessionId)
			}
		},
		[subAgentSessionId, onNavigateToSession],
	)

	// Skip rendering todoread parts (OpenCode filters these out)
	if (part.tool === "todoread" && !part.state?.output) return null

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger asChild>
				<button
					type="button"
					className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50 ${
						isError ? "text-red-400" : "text-muted-foreground"
					}`}
				>
					{isRunning ? (
						<Loader2Icon className="size-3.5 shrink-0 animate-spin" />
					) : (
						<ToolIcon className="size-3.5 shrink-0" />
					)}
					<span className="text-xs font-medium text-foreground">{title}</span>
					{subtitle && (
						<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
							{subtitle}
						</span>
					)}
					{canNavigate && (
						<button
							type="button"
							onClick={handleNavigate}
							className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
						>
							Open
							<ArrowRightIcon className="size-3" />
						</button>
					)}
					{hasContent && (
						<ChevronRightIcon
							className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
						/>
					)}
				</button>
			</CollapsibleTrigger>
			{hasContent && (
				<CollapsibleContent>
					<div className="ml-3 border-l border-border pl-3 pt-1 pb-2">
						<ToolContent part={part} />
					</div>
				</CollapsibleContent>
			)}
		</Collapsible>
	)
})
