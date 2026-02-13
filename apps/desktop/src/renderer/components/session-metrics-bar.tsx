/**
 * Compact session metrics bar for the agent-detail app bar.
 *
 * Shows work time, cost, tokens (with breakdown tooltip), turn count,
 * model distribution, cache efficiency, and error/retry indicators.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "@palot/ui/components/tooltip"
import { useAtomValue } from "jotai"
import {
	AlertTriangleIcon,
	CoinsIcon,
	MessageSquareIcon,
	RefreshCwIcon,
	TimerIcon,
	WrenchIcon,
	ZapIcon,
} from "lucide-react"
import { Fragment, memo } from "react"
import { sessionMetricsFamily } from "../atoms/derived/session-metrics"
import { formatTokens } from "../lib/session-metrics"

// ============================================================
// Tool category display labels
// ============================================================

const TOOL_CATEGORY_LABELS: Record<string, string> = {
	explore: "Read/Search",
	edit: "Edit/Write",
	run: "Run",
	delegate: "Agent",
	plan: "Plan",
	ask: "Ask",
	fetch: "Fetch",
	other: "Other",
}

// ============================================================
// SessionMetricsBar
// ============================================================

interface SessionMetricsBarProps {
	sessionId: string
}

/**
 * Compact metrics bar that reads from `sessionMetricsFamily` directly.
 * Only re-renders when the session's metrics change (structural equality).
 */
export const SessionMetricsBar = memo(function SessionMetricsBar({
	sessionId,
}: SessionMetricsBarProps) {
	const metrics = useAtomValue(sessionMetricsFamily(sessionId))

	if (metrics.turnCount === 0) return null

	const { raw } = metrics

	return (
		<div className="flex items-center gap-1.5">
			{/* Work time */}
			<Tooltip>
				<TooltipTrigger
					render={
						<span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground/60" />
					}
				>
					<TimerIcon className="size-3" aria-hidden="true" />
					{metrics.workTime}
				</TooltipTrigger>
				<TooltipContent side="bottom" align="end">
					<div className="space-y-1 text-xs">
						<p className="font-medium">Work Time</p>
						<p className="text-background/60">Avg per turn: {metrics.avgTurnTime}</p>
					</div>
				</TooltipContent>
			</Tooltip>

			<Separator />

			{/* Cost */}
			{metrics.costRaw > 0 && (
				<>
					<Tooltip>
						<TooltipTrigger
							render={
								<span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground/60" />
							}
						>
							<CoinsIcon className="size-3" aria-hidden="true" />
							{metrics.cost}
						</TooltipTrigger>
						<TooltipContent side="bottom" align="end">
							<div className="space-y-1 text-xs">
								<p className="font-medium">Cost</p>
								<p className="text-background/60">Avg per turn: {metrics.avgTurnCost}</p>
							</div>
						</TooltipContent>
					</Tooltip>

					<Separator />
				</>
			)}

			{/* Tokens with breakdown tooltip */}
			{metrics.tokensRaw > 0 && (
				<>
					<Tooltip>
						<TooltipTrigger
							render={
								<span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground/60" />
							}
						>
							<ZapIcon className="size-3" aria-hidden="true" />
							{metrics.tokens}
						</TooltipTrigger>
						<TooltipContent side="bottom" align="end">
							<div className="space-y-1.5 text-xs">
								<p className="font-medium">Token Breakdown</p>
								<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-background/60">
									<span>Input</span>
									<span className="text-right tabular-nums">{formatTokens(raw.tokens.input)}</span>
									<span>Output</span>
									<span className="text-right tabular-nums">{formatTokens(raw.tokens.output)}</span>
									{raw.tokens.reasoning > 0 && (
										<>
											<span>Reasoning</span>
											<span className="text-right tabular-nums">
												{formatTokens(raw.tokens.reasoning)}
											</span>
										</>
									)}
									<span>Cache read</span>
									<span className="text-right tabular-nums">
										{formatTokens(raw.tokens.cacheRead)}
									</span>
									{raw.tokens.cacheWrite > 0 && (
										<>
											<span>Cache write</span>
											<span className="text-right tabular-nums">
												{formatTokens(raw.tokens.cacheWrite)}
											</span>
										</>
									)}
								</div>
								{metrics.cacheEfficiency > 0 && (
									<p className="border-t border-background/15 pt-1 text-background/60">
										Cache hit rate: {metrics.cacheEfficiencyFormatted}
									</p>
								)}
							</div>
						</TooltipContent>
					</Tooltip>

					<Separator />
				</>
			)}

			{/* Turns + model distribution */}
			<Tooltip>
				<TooltipTrigger
					render={
						<span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground/60" />
					}
				>
					<MessageSquareIcon className="size-3" aria-hidden="true" />
					{metrics.turnCount}
				</TooltipTrigger>
				<TooltipContent side="bottom" align="end">
					<div className="space-y-1.5 text-xs">
						<p className="font-medium">
							{metrics.turnCount} {metrics.turnCount === 1 ? "turn" : "turns"}
						</p>
						{metrics.modelDistributionDisplay.length > 0 && (
							<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-background/60">
								{metrics.modelDistributionDisplay.map(({ name, count }) => (
									<Fragment key={name}>
										<span>{name}</span>
										<span className="text-right tabular-nums">
											{count} {count === 1 ? "turn" : "turns"}
										</span>
									</Fragment>
								))}
							</div>
						)}
					</div>
				</TooltipContent>
			</Tooltip>

			{/* Tool calls */}
			{metrics.toolCallCount > 0 && (
				<>
					<Separator />
					<Tooltip>
						<TooltipTrigger
							render={
								<span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground/60" />
							}
						>
							<WrenchIcon className="size-3" aria-hidden="true" />
							{metrics.toolCallCount}
						</TooltipTrigger>
						<TooltipContent side="bottom" align="end">
							<div className="space-y-1.5 text-xs">
								<p className="font-medium">Tool Calls</p>
								<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-background/60">
									{Object.entries(metrics.toolBreakdown)
										.sort(([, a], [, b]) => (Number(b) || 0) - (Number(a) || 0))
										.map(([cat, count]) => (
											<Fragment key={cat}>
												<span>{TOOL_CATEGORY_LABELS[cat] ?? cat}</span>
												<span className="text-right tabular-nums">{count}</span>
											</Fragment>
										))}
								</div>
							</div>
						</TooltipContent>
					</Tooltip>
				</>
			)}

			{/* Error/retry indicators */}
			{metrics.errorCount > 0 && (
				<>
					<Separator />
					<Tooltip>
						<TooltipTrigger
							render={
								<span className="inline-flex items-center gap-1 text-xs tabular-nums text-red-400/70" />
							}
						>
							<AlertTriangleIcon className="size-3" aria-hidden="true" />
							{metrics.errorCount}
						</TooltipTrigger>
						<TooltipContent side="bottom" align="end">
							<p className="text-xs">
								{metrics.errorCount} {metrics.errorCount === 1 ? "error" : "errors"}
								{metrics.retryCount > 0 &&
									`, ${metrics.retryCount} ${metrics.retryCount === 1 ? "retry" : "retries"}`}
							</p>
						</TooltipContent>
					</Tooltip>
				</>
			)}

			{/* Retry indicator (when retries but no errors) */}
			{metrics.retryCount > 0 && metrics.errorCount === 0 && (
				<>
					<Separator />
					<Tooltip>
						<TooltipTrigger
							render={
								<span className="inline-flex items-center gap-1 text-xs tabular-nums text-yellow-500/70" />
							}
						>
							<RefreshCwIcon className="size-3" aria-hidden="true" />
							{metrics.retryCount}
						</TooltipTrigger>
						<TooltipContent side="bottom" align="end">
							<p className="text-xs">
								{metrics.retryCount} {metrics.retryCount === 1 ? "retry" : "retries"}{" "}
								(auto-recovered)
							</p>
						</TooltipContent>
					</Tooltip>
				</>
			)}
		</div>
	)
})

// ============================================================
// Small separator dot
// ============================================================

function Separator() {
	return (
		<span className="text-muted-foreground/20" aria-hidden="true">
			·
		</span>
	)
}
