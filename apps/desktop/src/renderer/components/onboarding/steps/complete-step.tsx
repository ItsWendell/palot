/**
 * Onboarding: Complete / Ready.
 *
 * Shows a success state, quick tips, and an optional prompt to migrate
 * from Claude Code. The migration card only appears if the user hasn't
 * already migrated. Clicking it triggers the migration flow as a detour.
 */

import { Button } from "@palot/ui/components/button"
import { ArrowRightIcon, CheckCircle2Icon, CommandIcon } from "lucide-react"
import { motion } from "motion/react"
import type { MigrationResult } from "../../../../preload/api"

// ============================================================
// Types
// ============================================================

interface CompleteStepProps {
	opencodeVersion: string | null
	migrationPerformed: boolean
	migrationResult: MigrationResult | null
	onStartMigration: () => void
	onFinish: () => void
}

// ============================================================
// Component
// ============================================================

const isMac =
	typeof window !== "undefined" && "palot" in window && window.palot.platform === "darwin"

export function CompleteStep({
	opencodeVersion,
	migrationPerformed,
	migrationResult,
	onStartMigration,
	onFinish,
}: CompleteStepProps) {
	const modKey = isMac ? "Cmd" : "Ctrl"

	return (
		<div className="flex h-full flex-col items-center justify-center px-6">
			<div className="w-full max-w-md space-y-8 text-center">
				{/* Animated checkmark */}
				<motion.div
					className="flex justify-center"
					initial={{ scale: 0, opacity: 0 }}
					animate={{ scale: 1, opacity: 1 }}
					transition={{
						type: "spring",
						stiffness: 260,
						damping: 20,
						delay: 0.1,
					}}
				>
					<div className="flex size-16 items-center justify-center rounded-full bg-emerald-500/10">
						<CheckCircle2Icon className="size-8 text-emerald-500" />
					</div>
				</motion.div>

				{/* Title */}
				<motion.div
					initial={{ opacity: 0, y: 8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.3, duration: 0.3 }}
					className="space-y-2"
				>
					<h2 className="text-2xl font-semibold text-foreground">You're all set.</h2>
					<p className="text-sm text-muted-foreground">
						{opencodeVersion
							? `Palot is connected to OpenCode ${formatVersion(opencodeVersion)}`
							: "Palot is ready to go"}
						{migrationPerformed ? " and your Claude Code configuration has been migrated." : "."}
					</p>
				</motion.div>

				{/* Migration summary (shown after migration completes) */}
				{migrationResult && (
					<motion.div
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.45, duration: 0.3 }}
						data-slot="onboarding-card"
						className="rounded-lg border border-border bg-muted/20 p-3 text-left"
					>
						<div className="space-y-1 text-xs text-muted-foreground">
							{migrationResult.filesWritten.length > 0 && (
								<p>{migrationResult.filesWritten.length} file(s) created</p>
							)}
							{migrationResult.filesSkipped.length > 0 && (
								<p>{migrationResult.filesSkipped.length} file(s) skipped (already exist)</p>
							)}
							{migrationResult.backupDir && <p>Backup saved</p>}
							{migrationResult.manualActions.length > 0 && (
								<p className="text-amber-500">
									{migrationResult.manualActions.length} item(s) need manual attention
								</p>
							)}
						</div>
					</motion.div>
				)}

				{/* Claude Code migration opt-in (only if not already migrated) */}
				{!migrationPerformed && (
					<motion.div
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.45, duration: 0.3 }}
					>
						<button
							type="button"
							onClick={onStartMigration}
							data-slot="onboarding-card"
							className="group w-full cursor-pointer rounded-lg border border-border bg-muted/20 p-4 text-left transition-colors hover:bg-muted/40"
						>
							<div className="flex items-center justify-between">
								<div className="space-y-1">
									<p className="text-sm font-medium text-foreground">Migrate from Claude Code?</p>
									<p className="text-xs text-muted-foreground">
										Import your settings, MCP servers, agents, and rules.
									</p>
								</div>
								<ArrowRightIcon
									aria-hidden="true"
									className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
								/>
							</div>
						</button>
					</motion.div>
				)}

				{/* Quick tips */}
				<motion.div
					initial={{ opacity: 0, y: 8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.55, duration: 0.3 }}
					className="space-y-2"
				>
					<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/50">
						Quick tips
					</p>
					<div className="flex justify-center">
						<div className="space-y-1.5 text-left text-sm text-muted-foreground">
							<ShortcutRow keys={[modKey, "K"]} label="Command palette" />
							<ShortcutRow keys={[modKey, "N"]} label="New session" />
							<ShortcutRow keys={[modKey, ","]} label="Settings" />
						</div>
					</div>
				</motion.div>

				{/* CTA */}
				<motion.div
					initial={{ opacity: 0, y: 8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.7, duration: 0.3 }}
					className="flex items-center justify-center gap-3"
				>
					<Button size="lg" onClick={onFinish}>
						Start Building
					</Button>
				</motion.div>
			</div>
		</div>
	)
}

// ============================================================
// Helpers
// ============================================================

/** Format a version string for display. Semver gets a "v" prefix, non-semver gets parens. */
function formatVersion(version: string): string {
	if (/^\d+\.\d+/.test(version)) return `v${version}`
	return `(${version})`
}

// ============================================================
// Sub-components
// ============================================================

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
	return (
		<div className="flex items-center gap-3">
			<div className="flex items-center gap-0.5">
				{keys.map((key) => (
					<kbd
						key={key}
						className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground"
					>
						{key === "Cmd" ? <CommandIcon aria-hidden="true" className="size-2.5" /> : key}
					</kbd>
				))}
			</div>
			<span>{label}</span>
		</div>
	)
}
