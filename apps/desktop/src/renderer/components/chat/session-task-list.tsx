import { cn } from "@palot/ui/lib/utils"
import { useAtomValue } from "jotai"
import {
	CheckCircle2Icon,
	ChevronDownIcon,
	ChevronUpIcon,
	CircleDotIcon,
	ListTodoIcon,
	Loader2Icon,
	XCircleIcon,
} from "lucide-react"
import { useMemo, useState } from "react"
import { messagesFamily } from "../../atoms/messages"
import { partsFamily } from "../../atoms/parts"
import { appStore } from "../../atoms/store"
import { streamingVersionAtom } from "../../atoms/streaming"
import { todosFamily } from "../../atoms/todos"
import type { Todo } from "../../lib/types"

/**
 * Derives the latest todo list for a session.
 *
 * Priority order:
 * 1. Store `todos[sessionId]` — set by `todo.updated` SSE events (real-time)
 * 2. Fallback: extract from the last `todowrite` tool part in messages (for page loads)
 */
function useSessionTodos(sessionId: string | null): Todo[] {
	const storeTodos = useAtomValue(todosFamily(sessionId ?? ""))
	const storeMessages = useAtomValue(messagesFamily(sessionId ?? ""))
	const streamingVersion = useAtomValue(streamingVersionAtom)

	return useMemo(() => {
		// If we have SSE-pushed todos, prefer those — they're the most up-to-date
		if (storeTodos && storeTodos.length > 0) return storeTodos

		// Fallback: walk messages backwards to find the last todowrite part
		if (!storeMessages || storeMessages.length === 0) return []
		// streamingVersion in deps triggers recomputation when parts update
		void streamingVersion
		for (let i = storeMessages.length - 1; i >= 0; i--) {
			const msg = storeMessages[i]
			const parts = appStore.get(partsFamily(msg.id))
			if (!parts) continue
			for (let j = parts.length - 1; j >= 0; j--) {
				const part = parts[j]
				if (part.type === "tool" && part.tool === "todowrite") {
					const todos = part.state.input?.todos as Todo[] | undefined
					if (todos && todos.length > 0) return todos
				}
			}
		}
		return []
	}, [storeTodos, storeMessages, streamingVersion])
}

/** Status icon for a todo item */
function TodoStatusIcon({ status }: { status: string }) {
	switch (status) {
		case "completed":
			return <CheckCircle2Icon className="size-3.5 text-green-500" />
		case "in_progress":
			return <Loader2Icon className="size-3.5 animate-spin text-blue-400" />
		case "cancelled":
			return <XCircleIcon className="size-3.5 text-muted-foreground/50" />
		default:
			return <CircleDotIcon className="size-3.5 text-muted-foreground/40" />
	}
}

interface SessionTaskListProps {
	sessionId: string | null
}

/**
 * Collapsible task list that appears above the input field.
 * Shows the session's current todo list with completion progress.
 */
export function SessionTaskList({ sessionId }: SessionTaskListProps) {
	const todos = useSessionTodos(sessionId)
	const [isExpanded, setIsExpanded] = useState(true)

	const completedCount = useMemo(
		() => todos.filter((t) => t.status === "completed").length,
		[todos],
	)

	// Don't render anything if there are no todos
	if (todos.length === 0) return null

	const allCompleted = completedCount === todos.length

	return (
		<div className="mb-2 rounded-xl border border-border bg-card">
			{/* Header — always visible, toggles expansion */}
			<button
				type="button"
				onClick={() => setIsExpanded((prev) => !prev)}
				className={cn(
					"flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50",
					isExpanded ? "rounded-t-xl" : "rounded-xl",
				)}
			>
				<ListTodoIcon className="size-4 shrink-0 text-muted-foreground" />
				<span className="flex-1 text-muted-foreground">
					<span className={allCompleted ? "text-green-500" : "text-foreground"}>
						{completedCount}
					</span>{" "}
					out of {todos.length} tasks completed
				</span>
				{isExpanded ? (
					<ChevronUpIcon className="size-3.5 shrink-0 text-muted-foreground" />
				) : (
					<ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
				)}
			</button>

			{/* Expanded content — task list */}
			{isExpanded && (
				<div className="border-t border-border px-3 pb-2.5 pt-2">
					<ol className="space-y-1">
						{todos.map((todo, index) => (
							<li key={todo.id || `todo-${index}`} className="flex items-start gap-2 text-sm">
								<span className="mt-0.5 shrink-0">
									<TodoStatusIcon status={todo.status} />
								</span>
								<span className="flex items-start gap-1.5">
									<span className="shrink-0 text-muted-foreground/60">{index + 1}.</span>
									<span
										className={
											todo.status === "completed"
												? "text-muted-foreground line-through"
												: todo.status === "cancelled"
													? "text-muted-foreground/50 line-through"
													: todo.status === "in_progress"
														? "text-foreground"
														: "text-foreground/80"
										}
									>
										{todo.content}
									</span>
								</span>
							</li>
						))}
					</ol>
				</div>
			)}
		</div>
	)
}
