import { AlertTriangleIcon, XIcon, ZapIcon } from "lucide-react"
import type { StuckReason, WatchdogAnalysis } from "../../lib/session-watchdog"

interface WatchdogBannerProps {
	analysis: WatchdogAnalysis
	onDismiss: () => void
	onNudge?: () => void
}

const REASON_LABELS: Record<StuckReason, string> = {
	"repeated-todo": "Repeated TODO lists",
	"repeated-next-steps": "Repeated next steps",
	"repeated-summary": "Repeated summaries",
	"no-file-changes": "No file changes",
	"planning-loop": "Planning loop",
	"agent-waiting-on-self": "Agent waiting on itself",
}

export function WatchdogBanner({ analysis, onDismiss, onNudge }: WatchdogBannerProps) {
	if (!analysis.isStuck || !analysis.stuckReason) return null

	return (
		<div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-400">
			<AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
			<div className="min-w-0 flex-1">
				<span className="font-medium">{REASON_LABELS[analysis.stuckReason]}</span>
				<span className="ml-1 opacity-75">— agent may be stuck</span>
			</div>
			{onNudge && (
				<button
					type="button"
					onClick={onNudge}
					className="flex shrink-0 items-center gap-1 rounded-md bg-amber-200/60 px-2 py-1 text-[11px] font-medium text-amber-900 transition-colors hover:bg-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
				>
					<ZapIcon className="size-3" />
					Stop & nudge
				</button>
			)}
			<button
				type="button"
				onClick={onDismiss}
				className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
				aria-label="Dismiss"
			>
				<XIcon className="size-3.5" />
			</button>
		</div>
	)
}
