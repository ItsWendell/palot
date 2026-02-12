import { ArrowDownToLineIcon, RefreshCwIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { useUpdater } from "../hooks/use-updater"

/**
 * Non-intrusive update banner that appears at the top of the app
 * when a new version is available, downloading, or ready to install.
 *
 * Hidden when idle, checking, or dismissed by the user.
 */
export function UpdateBanner() {
	const { status, version, progress, downloadUpdate, installUpdate } = useUpdater()
	const [dismissed, setDismissed] = useState(false)

	// Don't show for idle/checking/error states, or if dismissed
	if (dismissed || status === "idle" || status === "checking" || status === "error") {
		return null
	}

	return (
		<div className="flex items-center gap-3 border-b border-border bg-muted/50 px-4 py-2 text-sm">
			{status === "available" && (
				<>
					<span className="flex-1">
						A new version{version ? ` (v${version})` : ""} is available.
					</span>
					<button
						type="button"
						onClick={() => downloadUpdate()}
						className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					>
						<ArrowDownToLineIcon className="size-3.5" aria-hidden="true" />
						Download
					</button>
				</>
			)}

			{status === "downloading" && (
				<>
					<span className="flex-1">
						Downloading update{version ? ` v${version}` : ""}
						{progress ? ` — ${Math.round(progress.percent)}%` : "..."}
					</span>
					<div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-primary transition-all duration-300"
							style={{ width: `${progress?.percent ?? 0}%` }}
						/>
					</div>
				</>
			)}

			{status === "ready" && (
				<>
					<span className="flex-1">
						Update{version ? ` v${version}` : ""} is ready. Restart to apply.
					</span>
					<button
						type="button"
						onClick={() => installUpdate()}
						className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					>
						<RefreshCwIcon className="size-3.5" aria-hidden="true" />
						Restart now
					</button>
				</>
			)}

			{/* Dismiss button — always visible */}
			<button
				type="button"
				onClick={() => setDismissed(true)}
				className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
				aria-label="Dismiss update notification"
			>
				<XIcon className="size-4" aria-hidden="true" />
			</button>
		</div>
	)
}
