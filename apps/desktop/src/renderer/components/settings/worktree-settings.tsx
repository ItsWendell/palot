/**
 * Worktree management settings page.
 *
 * Lists all managed worktrees with disk usage, branch name, project name,
 * last active date, and a delete button. Shows total disk usage at the top.
 */

import { Button } from "@palot/ui/components/button"
import { AlertTriangleIcon, GitForkIcon, Loader2Icon, RotateCcwIcon, TrashIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { ManagedWorktree } from "../../../preload/api"
import { listManagedWorktrees, pruneWorktrees } from "../../services/backend"
import { removeWorktree, resetWorktree } from "../../services/worktree-service"
import { SettingsSection } from "./settings-section"

// ============================================================
// Helpers
// ============================================================

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B"
	const units = ["B", "KB", "MB", "GB"]
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
	const value = bytes / 1024 ** i
	return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function formatRelativeDate(timestampMs: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000))
	if (seconds < 60) return "just now"
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	if (days < 30) return `${days}d ago`
	return new Date(timestampMs).toLocaleDateString()
}

const DISK_WARNING_THRESHOLD = 5 * 1024 * 1024 * 1024 // 5 GB

// ============================================================
// Main component
// ============================================================

export function WorktreeSettings() {
	const [worktrees, setWorktrees] = useState<ManagedWorktree[]>([])
	const [loading, setLoading] = useState(true)
	const [removing, setRemoving] = useState<string | null>(null)
	const [resetting, setResetting] = useState<string | null>(null)
	const [pruning, setPruning] = useState(false)

	const loadWorktrees = useCallback(async () => {
		try {
			const result = await listManagedWorktrees()
			setWorktrees(result)
		} catch {
			// Silently fail — may not be in Electron mode
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadWorktrees()
	}, [loadWorktrees])

	const totalDiskUsage = useMemo(
		() => worktrees.reduce((sum, wt) => sum + wt.diskUsageBytes, 0),
		[worktrees],
	)

	const handleRemove = useCallback(
		async (wt: ManagedWorktree) => {
			setRemoving(wt.path)
			try {
				await removeWorktree(wt.sourceRepo || wt.path, wt.path, wt.sourceRepo)
				await loadWorktrees()
			} catch {
				// Silently fail
			} finally {
				setRemoving(null)
			}
		},
		[loadWorktrees],
	)

	const handleReset = useCallback(
		async (wt: ManagedWorktree) => {
			setResetting(wt.path)
			try {
				await resetWorktree(wt.sourceRepo || wt.path, wt.path)
				await loadWorktrees()
			} catch {
				// Silently fail
			} finally {
				setResetting(null)
			}
		},
		[loadWorktrees],
	)

	const handlePruneAll = useCallback(async () => {
		setPruning(true)
		try {
			await pruneWorktrees(0) // 0 = prune all
			await loadWorktrees()
		} catch {
			// Silently fail
		} finally {
			setPruning(false)
		}
	}, [loadWorktrees])

	const isOverThreshold = totalDiskUsage > DISK_WARNING_THRESHOLD

	return (
		<div className="space-y-8">
			<div>
				<h2 className="text-xl font-semibold">Worktrees</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Manage git worktrees created for isolated agent sessions.
				</p>
			</div>

			{/* Summary */}
			<SettingsSection title="Disk Usage">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-2">
						<GitForkIcon className="size-4 text-muted-foreground" aria-hidden="true" />
						<span className="text-sm">
							{worktrees.length} worktree{worktrees.length !== 1 ? "s" : ""}
						</span>
						{isOverThreshold && (
							<span className="flex items-center gap-1 text-xs text-orange-500">
								<AlertTriangleIcon className="size-3" aria-hidden="true" />
								Exceeds 5 GB
							</span>
						)}
					</div>
					<div className="flex items-center gap-3">
						<span
							className={`text-sm font-medium ${isOverThreshold ? "text-orange-500" : "text-muted-foreground"}`}
						>
							{formatBytes(totalDiskUsage)}
						</span>
						{worktrees.length > 0 && (
							<Button
								size="sm"
								variant="outline"
								onClick={handlePruneAll}
								disabled={pruning || worktrees.length === 0}
								className="h-7 text-xs"
							>
								{pruning ? (
									<>
										<Loader2Icon className="size-3 animate-spin" />
										Cleaning...
									</>
								) : (
									"Clean all"
								)}
							</Button>
						)}
					</div>
				</div>
			</SettingsSection>

			{/* Worktree list */}
			{loading ? (
				<div className="flex items-center justify-center py-8">
					<Loader2Icon className="size-5 animate-spin text-muted-foreground" />
				</div>
			) : worktrees.length === 0 ? (
				<div className="rounded-lg border border-dashed border-border py-8 text-center">
					<GitForkIcon className="mx-auto size-8 text-muted-foreground/30" aria-hidden="true" />
					<p className="mt-2 text-sm text-muted-foreground">No worktrees</p>
					<p className="text-xs text-muted-foreground/60">
						Worktrees will appear here when you create sessions in worktree mode.
					</p>
				</div>
			) : (
				<SettingsSection title="Active Worktrees">
					{worktrees
						.sort((a, b) => b.lastModifiedAt - a.lastModifiedAt)
						.map((wt) => (
							<WorktreeRow
								key={wt.path}
								worktree={wt}
								isRemoving={removing === wt.path}
								isResetting={resetting === wt.path}
								onRemove={() => handleRemove(wt)}
								onReset={() => handleReset(wt)}
							/>
						))}
				</SettingsSection>
			)}
		</div>
	)
}

// ============================================================
// Sub-components
// ============================================================

function WorktreeRow({
	worktree,
	isRemoving,
	isResetting,
	onRemove,
	onReset,
}: {
	worktree: ManagedWorktree
	isRemoving: boolean
	isResetting: boolean
	onRemove: () => void
	onReset: () => void
}) {
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<GitForkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-medium">{worktree.projectName}</span>
					{worktree.branch && (
						<span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
							{worktree.branch}
						</span>
					)}
				</div>
				<div className="flex items-center gap-2 text-xs text-muted-foreground/60">
					<span>{formatBytes(worktree.diskUsageBytes)}</span>
					<span>-</span>
					<span>{formatRelativeDate(worktree.lastModifiedAt)}</span>
				</div>
			</div>

			<Button
				size="sm"
				variant="ghost"
				onClick={onReset}
				disabled={isResetting || isRemoving}
				className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
				title="Reset worktree to default branch"
			>
				{isResetting ? (
					<Loader2Icon className="size-3.5 animate-spin" />
				) : (
					<RotateCcwIcon className="size-3.5" />
				)}
			</Button>

			<Button
				size="sm"
				variant="ghost"
				onClick={onRemove}
				disabled={isRemoving || isResetting}
				className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-red-500"
				title="Remove worktree"
			>
				{isRemoving ? (
					<Loader2Icon className="size-3.5 animate-spin" />
				) : (
					<TrashIcon className="size-3.5" />
				)}
			</Button>
		</div>
	)
}
