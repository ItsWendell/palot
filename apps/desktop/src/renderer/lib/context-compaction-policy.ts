/**
 * Pure context compaction policy decisions.
 *
 * The caller owns state and side effects. This module only converts known
 * context usage into the UI/runtime state Nexus Builder should apply.
 */
import type { ContextUsage } from "./session-metrics"

export type ContextCompactionState =
	| "NORMAL"
	| "HIGH_CONTEXT"
	| "COMPACTION_SUGGESTED"
	| "AUTO_COMPACTING"
	| "COMPACTED"
	| "BLOCKED_UNTIL_COMPACTED"

export interface ContextCompactionThresholds {
	warn: number
	suggest: number
	autoCompact: number
	block: number
}

export interface ContextCompactionPolicyInput {
	usage: Pick<ContextUsage, "percentage" | "compactionPercentage"> | null
	thresholds?: Partial<ContextCompactionThresholds>
	isCompacting?: boolean
	wasCompacted?: boolean
	autoCompactionEnabled?: boolean
}

export interface ContextCompactionPolicyResult {
	state: ContextCompactionState
	percentage: number
	severity: "info" | "warning" | "critical"
	shouldAutoCompact: boolean
	shouldBlockNewWork: boolean
	operatorMessage: string
	recommendedAction: string
}

export const DEFAULT_CONTEXT_COMPACTION_THRESHOLDS: ContextCompactionThresholds = {
	warn: 60,
	suggest: 75,
	autoCompact: 85,
	block: 95,
}

function mergeThresholds(
	thresholds?: Partial<ContextCompactionThresholds>,
): ContextCompactionThresholds {
	return {
		...DEFAULT_CONTEXT_COMPACTION_THRESHOLDS,
		...thresholds,
	}
}

function getPolicyPercentage(
	usage: Pick<ContextUsage, "percentage" | "compactionPercentage"> | null,
): number {
	if (!usage) return 0
	return Math.max(usage.percentage, usage.compactionPercentage ?? 0)
}

export function evaluateContextCompactionPolicy({
	usage,
	thresholds,
	isCompacting = false,
	wasCompacted = false,
	autoCompactionEnabled = true,
}: ContextCompactionPolicyInput): ContextCompactionPolicyResult {
	const resolvedThresholds = mergeThresholds(thresholds)
	const percentage = getPolicyPercentage(usage)

	if (isCompacting) {
		return {
			state: "AUTO_COMPACTING",
			percentage,
			severity: "warning",
			shouldAutoCompact: false,
			shouldBlockNewWork: true,
			operatorMessage: "Auto-compacting context.",
			recommendedAction: "Wait for compaction to finish before sending more work.",
		}
	}

	if (wasCompacted) {
		return {
			state: "COMPACTED",
			percentage,
			severity: "info",
			shouldAutoCompact: false,
			shouldBlockNewWork: false,
			operatorMessage: "Context was compacted.",
			recommendedAction: "Continue normally.",
		}
	}

	if (percentage >= resolvedThresholds.block) {
		return {
			state: "BLOCKED_UNTIL_COMPACTED",
			percentage,
			severity: "critical",
			shouldAutoCompact: autoCompactionEnabled,
			shouldBlockNewWork: true,
			operatorMessage: "Context is critically full.",
			recommendedAction: "Compact context before starting new or delegated work.",
		}
	}

	if (percentage >= resolvedThresholds.autoCompact) {
		return {
			state: "AUTO_COMPACTING",
			percentage,
			severity: "warning",
			shouldAutoCompact: autoCompactionEnabled,
			shouldBlockNewWork: false,
			operatorMessage: "Context is high enough to auto-compact.",
			recommendedAction: "Nexus Builder will compact before sending the next prompt.",
		}
	}

	if (percentage >= resolvedThresholds.suggest) {
		return {
			state: "COMPACTION_SUGGESTED",
			percentage,
			severity: "warning",
			shouldAutoCompact: false,
			shouldBlockNewWork: false,
			operatorMessage: "Context compaction is suggested.",
			recommendedAction: "Compact soon to preserve room for tool results and child agents.",
		}
	}

	if (percentage >= resolvedThresholds.warn) {
		return {
			state: "HIGH_CONTEXT",
			percentage,
			severity: "info",
			shouldAutoCompact: false,
			shouldBlockNewWork: false,
			operatorMessage: "Context usage is getting high.",
			recommendedAction: "Keep prompts concise.",
		}
	}

	return {
		state: "NORMAL",
		percentage,
		severity: "info",
		shouldAutoCompact: false,
		shouldBlockNewWork: false,
		operatorMessage: "Context usage is normal.",
		recommendedAction: "Continue normally.",
	}
}
