/**
 * Claude Code Migration Offer.
 *
 * Scans the user's Claude Code configuration and lets them select which
 * categories to migrate. The user explicitly opted in, so scanning
 * happens on mount. Generates a dry-run preview before proceeding.
 */

import { Button } from "@palot/ui/components/button"
import { Checkbox } from "@palot/ui/components/checkbox"
import { Spinner } from "@palot/ui/components/spinner"
import {
	ArrowRightIcon,
	BotIcon,
	CogIcon,
	FileTextIcon,
	FolderOpenIcon,
	PlugIcon,
	ScrollTextIcon,
	ServerIcon,
	ShieldIcon,
	TerminalIcon,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { ClaudeCodeDetection, MigrationPreview } from "../../../../preload/api"

// ============================================================
// Types
// ============================================================

interface MigrationCategory {
	id: string
	label: string
	description: string
	icon: typeof CogIcon
	count: number
	enabled: boolean
}

interface MigrationOfferStepProps {
	onPreview: (scanResult: unknown, categories: string[], preview: MigrationPreview) => void
	onSkip: () => void
}

// ============================================================
// Component
// ============================================================

export function MigrationOfferStep({ onPreview, onSkip }: MigrationOfferStepProps) {
	const [categories, setCategories] = useState<MigrationCategory[]>([])
	const [scanning, setScanning] = useState(false)
	const [scanError, setScanError] = useState<string | null>(null)
	const [previewing, setPreviewing] = useState(false)
	const hasScanned = useRef(false)
	const scanResultRef = useRef<unknown>(null)

	const isElectron = typeof window !== "undefined" && "palot" in window

	// Run full scan on mount (user explicitly opted in)
	useEffect(() => {
		if (!isElectron || hasScanned.current) return
		hasScanned.current = true
		setScanning(true)

		window.palot.onboarding
			.scanClaudeCode()
			.then(({ detection: fullDetection, scanResult }) => {
				scanResultRef.current = scanResult
				setCategories(buildCategories(fullDetection))
				setScanning(false)
			})
			.catch((err) => {
				setScanError(err instanceof Error ? err.message : "Scan failed")
				setScanning(false)
			})
	}, [isElectron])

	const toggleCategory = useCallback((id: string) => {
		setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)))
	}, [])

	const handlePreview = useCallback(async () => {
		if (!isElectron || !scanResultRef.current) return
		setPreviewing(true)
		setScanError(null)

		const selectedIds = categories.filter((c) => c.enabled).map((c) => c.id)

		try {
			const preview = await window.palot.onboarding.previewMigration(
				scanResultRef.current,
				selectedIds,
			)
			onPreview(scanResultRef.current, selectedIds, preview)
		} catch (err) {
			setScanError(err instanceof Error ? err.message : "Preview failed")
		} finally {
			setPreviewing(false)
		}
	}, [isElectron, categories, onPreview])

	const enabledCount = categories.filter((c) => c.enabled).length

	return (
		<div className="flex h-full flex-col items-center justify-center px-6">
			<div className="w-full max-w-lg space-y-6">
				<div className="text-center">
					<h2 className="text-xl font-semibold text-foreground">Migrate from Claude Code</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						We detected an existing Claude Code setup. Palot can migrate your configuration to
						OpenCode format.
					</p>
				</div>

				{/* Loading state */}
				{scanning && (
					<div
						data-slot="onboarding-card"
						className="flex items-center justify-center gap-3 rounded-lg border border-border bg-muted/30 p-6"
					>
						<Spinner className="size-4" />
						<span className="text-sm text-muted-foreground">
							Scanning Claude Code configuration...
						</span>
					</div>
				)}

				{/* Category checkboxes */}
				{!scanning && categories.length > 0 && (
					<div className="space-y-2">
						{categories.map((cat) => {
							if (cat.count === 0) return null
							const Icon = cat.icon
							return (
								<button
									type="button"
									key={cat.id}
									data-slot="onboarding-card"
									onClick={() => toggleCategory(cat.id)}
									className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:bg-muted/30"
								>
									<Checkbox
										checked={cat.enabled}
										onCheckedChange={() => toggleCategory(cat.id)}
										aria-label={cat.label}
									/>
									<Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium text-foreground">{cat.label}</p>
										<p className="text-xs text-muted-foreground">{cat.description}</p>
									</div>
									<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
										{cat.count}
									</span>
								</button>
							)
						})}
					</div>
				)}

				{/* Info about what migration does */}
				{!scanning && categories.length > 0 && (
					<div
						data-slot="onboarding-card"
						className="rounded-lg border border-border bg-muted/20 p-3"
					>
						<p className="text-xs leading-relaxed text-muted-foreground">
							Model IDs are translated automatically. MCP servers are converted to OpenCode format.
							Agent frontmatter is adapted. A backup is created before any changes, and you can undo
							at any time from Settings.
						</p>
					</div>
				)}

				{/* Error */}
				{scanError && (
					<div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500">
						{scanError}
					</div>
				)}

				{/* Actions */}
				<div className="flex items-center justify-center gap-3">
					<Button variant="outline" onClick={onSkip}>
						Back
					</Button>
					{!scanning && categories.length > 0 && (
						<Button
							onClick={handlePreview}
							disabled={enabledCount === 0 || previewing}
							className="gap-2"
						>
							{previewing ? (
								<>
									<Spinner className="size-3.5" />
									Preparing preview...
								</>
							) : (
								<>
									Preview Changes
									<ArrowRightIcon aria-hidden="true" className="size-4" />
								</>
							)}
						</Button>
					)}
				</div>
			</div>
		</div>
	)
}

// ============================================================
// Helpers
// ============================================================

function buildCategories(detection: ClaudeCodeDetection): MigrationCategory[] {
	// Build a human-readable description for the history row
	const historyParts: string[] = []
	if (detection.projectCount > 0) {
		historyParts.push(`${detection.projectCount} project${detection.projectCount === 1 ? "" : "s"}`)
	}
	if (detection.totalSessions > 0) {
		historyParts.push(
			`${detection.totalSessions} session${detection.totalSessions === 1 ? "" : "s"}`,
		)
	}

	return [
		{
			id: "config",
			label: "Global settings & model preferences",
			description: "Model IDs, provider config, auto-update settings",
			icon: CogIcon,
			count: detection.hasGlobalSettings || detection.hasUserState ? 1 : 0,
			enabled: true,
		},
		{
			id: "mcp",
			label: "MCP server configurations",
			description: "Local and remote MCP server definitions",
			icon: ServerIcon,
			count: detection.mcpServerCount,
			enabled: true,
		},
		{
			id: "history",
			label: "Projects & sessions",
			description: historyParts.length > 0 ? historyParts.join(", ") : "No sessions found",
			icon: FolderOpenIcon,
			count: detection.totalSessions,
			enabled: detection.totalSessions > 0,
		},
		{
			id: "agents",
			label: "Custom agents",
			description: "Agent definitions with tools and model preferences",
			icon: BotIcon,
			count: detection.agentCount,
			enabled: true,
		},
		{
			id: "commands",
			label: "Custom commands",
			description: "Command templates with parameters",
			icon: TerminalIcon,
			count: detection.commandCount,
			enabled: true,
		},
		{
			id: "rules",
			label: "Project rules (CLAUDE.md)",
			description: "Copied as AGENTS.md for OpenCode",
			icon: ScrollTextIcon,
			count: detection.hasRules ? 1 : 0,
			enabled: true,
		},
		{
			id: "permissions",
			label: "Permission settings",
			description: "Tool allow/deny/ask rules",
			icon: ShieldIcon,
			count: detection.hasGlobalSettings ? 1 : 0,
			enabled: true,
		},
		{
			id: "hooks",
			label: "Hooks",
			description: "Converted to TypeScript plugin stubs (manual finishing needed)",
			icon: PlugIcon,
			count: detection.hasHooks ? 1 : 0,
			enabled: true,
		},
		{
			id: "skills",
			label: "Skills",
			description: "Verified for compatibility",
			icon: FileTextIcon,
			count: detection.skillCount,
			enabled: true,
		},
	]
}
