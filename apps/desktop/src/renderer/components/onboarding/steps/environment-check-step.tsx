/**
 * Onboarding Step 2: Environment Check.
 *
 * Verifies OpenCode CLI is installed and compatible. Offers install/update
 * if needed.
 */

import { Button } from "@palot/ui/components/button"
import { Spinner } from "@palot/ui/components/spinner"
import {
	AlertCircleIcon,
	ArrowRightIcon,
	CheckCircle2Icon,
	DownloadIcon,
	RefreshCwIcon,
	XCircleIcon,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { OpenCodeCheckResult } from "../../../../preload/api"

// ============================================================
// Types
// ============================================================

type CheckStatus = "pending" | "running" | "success" | "warning" | "error"

interface CheckItem {
	id: string
	label: string
	status: CheckStatus
	detail?: string
}

interface EnvironmentCheckStepProps {
	onComplete: (version: string | null) => void
	onSkip: () => void
}

// ============================================================
// Component
// ============================================================

export function EnvironmentCheckStep({ onComplete, onSkip }: EnvironmentCheckStepProps) {
	const [checks, setChecks] = useState<CheckItem[]>([
		{ id: "locate", label: "Locating OpenCode CLI", status: "pending" },
		{ id: "version", label: "Checking version compatibility", status: "pending" },
	])
	const [openCodeResult, setOpenCodeResult] = useState<OpenCodeCheckResult | null>(null)
	const [installing, setInstalling] = useState(false)
	const [installOutput, setInstallOutput] = useState<string[]>([])
	const [allDone, setAllDone] = useState(false)
	const hasRun = useRef(false)
	const terminalRef = useRef<HTMLDivElement>(null)

	const isElectron = typeof window !== "undefined" && "palot" in window

	const updateCheck = useCallback((id: string, update: Partial<CheckItem>) => {
		setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, ...update } : c)))
	}, [])

	// --- Run checks ---

	const runChecks = useCallback(async () => {
		if (!isElectron) return

		// Reset
		setAllDone(false)
		setOpenCodeResult(null)
		setChecks([
			{ id: "locate", label: "Locating OpenCode CLI", status: "running" },
			{ id: "version", label: "Checking version compatibility", status: "pending" },
		])

		try {
			// Step 1: Check OpenCode installation
			const result = await window.palot.onboarding.checkOpenCode()
			setOpenCodeResult(result)

			if (!result.installed) {
				updateCheck("locate", {
					status: "error",
					label: "OpenCode CLI not found",
					detail: "Install OpenCode to continue",
				})
				return
			}

			updateCheck("locate", {
				status: "success",
				label: `OpenCode ${result.version} found`,
				detail: result.path ?? undefined,
			})

			// Step 2: Version compatibility
			updateCheck("version", { status: "running" })
			await new Promise((r) => setTimeout(r, 300)) // Brief pause for visual feedback

			if (result.compatibility === "too-old") {
				updateCheck("version", {
					status: "error",
					label: "Version not compatible",
					detail: result.message ?? undefined,
				})
				return
			}

			if (result.compatibility === "too-new") {
				updateCheck("version", {
					status: "warning",
					label: "Newer than tested",
					detail: result.message ?? undefined,
				})
			} else if (result.compatibility === "blocked") {
				updateCheck("version", {
					status: "error",
					label: "Version blocked",
					detail: result.message ?? undefined,
				})
				return
			} else {
				updateCheck("version", {
					status: "success",
					label: "Version compatible",
				})
			}

			setAllDone(true)
		} catch (err) {
			const message = err instanceof Error ? err.message : "Check failed"
			updateCheck("locate", { status: "error", detail: message })
		}
	}, [isElectron, updateCheck])

	useEffect(() => {
		if (hasRun.current) return
		hasRun.current = true
		runChecks()
	}, [runChecks])

	// --- Install handler ---

	const handleInstall = useCallback(async () => {
		if (!isElectron) return
		setInstalling(true)
		setInstallOutput([])

		const cleanup = window.palot.onboarding.onInstallOutput((text) => {
			setInstallOutput((prev) => [...prev, text])
		})

		try {
			const result = await window.palot.onboarding.installOpenCode()
			cleanup()

			if (result.success) {
				setInstalling(false)
				// Re-run checks after install
				hasRun.current = false
				runChecks()
			} else {
				setInstallOutput((prev) => [
					...prev,
					`\nInstallation failed: ${result.error ?? "Unknown error"}`,
				])
				setInstalling(false)
			}
		} catch (err) {
			cleanup()
			setInstallOutput((prev) => [
				...prev,
				`\nError: ${err instanceof Error ? err.message : "Installation failed"}`,
			])
			setInstalling(false)
		}
	}, [isElectron, runChecks])

	// Auto-scroll terminal when new output arrives
	// biome-ignore lint/correctness/useExhaustiveDependencies: installOutput triggers scroll on new output
	useEffect(() => {
		if (terminalRef.current) {
			terminalRef.current.scrollTop = terminalRef.current.scrollHeight
		}
	}, [installOutput])

	// --- Render ---

	const needsInstall = openCodeResult && !openCodeResult.installed
	const needsUpdate = openCodeResult?.compatibility === "too-old"
	const showInstallUI = needsInstall || needsUpdate

	return (
		<div className="flex h-full flex-col items-center justify-center px-6">
			<div className="w-full max-w-lg space-y-6">
				<div className="text-center">
					<h2 className="text-xl font-semibold text-foreground">Environment Check</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Verifying your setup is ready for Palot.
					</p>
				</div>

				{/* Check list */}
				<div className="space-y-3">
					{checks.map((check) => (
						<div
							key={check.id}
							data-slot="onboarding-card"
							className="flex items-start gap-3 rounded-lg border border-border bg-background p-3"
						>
							<div className="mt-0.5 shrink-0">
								<CheckStatusIcon status={check.status} />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium text-foreground">{check.label}</p>
								{check.detail && (
									<p className="mt-0.5 text-xs text-muted-foreground">{check.detail}</p>
								)}
							</div>
						</div>
					))}
				</div>

				{/* Install UI */}
				{showInstallUI && !installing && (
					<div
						data-slot="onboarding-card"
						className="space-y-3 rounded-lg border border-border bg-muted/30 p-4"
					>
						<p className="text-sm text-muted-foreground">
							{needsUpdate
								? "Your OpenCode version is too old. Update to continue."
								: "Palot needs the OpenCode CLI to function. Install it to continue."}
						</p>
						<div className="flex gap-2">
							<Button size="sm" onClick={handleInstall} className="gap-2">
								<DownloadIcon aria-hidden="true" className="size-3.5" />
								{needsUpdate ? "Update for me" : "Install for me"}
							</Button>
							<Button size="sm" variant="outline" onClick={onSkip}>
								{needsUpdate ? "Continue anyway" : "I'll install manually"}
							</Button>
						</div>
						<p className="text-xs text-muted-foreground/60">
							Or run: curl -fsSL https://opencode.ai/install | bash
						</p>
					</div>
				)}

				{/* Install terminal output */}
				{(installing || installOutput.length > 0) && (
					<div
						ref={terminalRef}
						className="max-h-48 overflow-y-auto rounded-lg border border-border bg-zinc-950 p-3 font-mono text-xs text-zinc-300"
					>
						{installOutput.map((line, i) => (
							<div
								key={`line-${
									// biome-ignore lint/suspicious/noArrayIndexKey: terminal output lines are append-only
									i
								}`}
								className="whitespace-pre-wrap break-all"
							>
								{line}
							</div>
						))}
						{installing && (
							<div className="mt-1 flex items-center gap-2 text-zinc-400">
								<Spinner className="size-3" />
								Installing...
							</div>
						)}
					</div>
				)}

				{/* Retry / Continue buttons */}
				<div className="flex justify-center gap-3">
					{!allDone && !showInstallUI && !installing && (
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								hasRun.current = false
								runChecks()
							}}
							className="gap-2"
						>
							<RefreshCwIcon aria-hidden="true" className="size-3.5" />
							Re-check
						</Button>
					)}

					{allDone && (
						<Button
							size="default"
							onClick={() => onComplete(openCodeResult?.version ?? null)}
							className="gap-2"
						>
							Continue
							<ArrowRightIcon aria-hidden="true" className="size-4" />
						</Button>
					)}
				</div>
			</div>
		</div>
	)
}

// ============================================================
// Sub-components
// ============================================================

function CheckStatusIcon({ status }: { status: CheckStatus }) {
	switch (status) {
		case "pending":
			return <div className="size-4 rounded-full border border-muted-foreground/20" />
		case "running":
			return <Spinner className="size-4" />
		case "success":
			return <CheckCircle2Icon className="size-4 text-emerald-500" />
		case "warning":
			return <AlertCircleIcon className="size-4 text-amber-500" />
		case "error":
			return <XCircleIcon className="size-4 text-red-500" />
	}
}
