import { GitForkIcon, Loader2Icon, SquareIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import type { SessionSetupPhase } from "../../atoms/sessions"
import { formatWorkDuration } from "../../lib/session-metrics"
import type { DiffComment } from "../review/diff-comment-model"

/**
 * Compact live timer that shows actual assistant work time for the current turn.
 */
export function LiveTurnTimer({
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

const SETUP_PHASE_LABELS: Record<NonNullable<SessionSetupPhase>, string> = {
	"creating-worktree": "Creating worktree...",
	"starting-session": "Starting session...",
}

export function WorktreeSetupProgress({ phase }: { phase: NonNullable<SessionSetupPhase> }) {
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

export function DiffCommentChips({
	comments,
	onRemove,
}: {
	comments: DiffComment[]
	onRemove: (id: string) => void
}) {
	if (comments.length === 0) return null

	return (
		<div className="flex flex-wrap gap-1 px-1 pt-1">
			{comments.map((comment) => {
				const fileName = comment.filePath.split("/").pop() ?? comment.filePath
				return (
					<span
						key={comment.id}
						className="inline-flex max-w-full items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] leading-tight"
					>
						<span className="shrink-0 font-mono text-muted-foreground">
							{fileName}:{comment.lineNumber}
						</span>
						<span className="truncate text-foreground">
							{comment.content.length > 40 ? `${comment.content.slice(0, 40)}...` : comment.content}
						</span>
						<button
							type="button"
							onClick={() => onRemove(comment.id)}
							className="shrink-0 text-muted-foreground/60 hover:text-foreground"
						>
							<XIcon className="size-2.5" />
						</button>
					</span>
				)
			})}
		</div>
	)
}
