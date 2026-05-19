/**
 * Session watchdog — detects stuck agent execution loops.
 *
 * Pure functions only. No React, no IPC, fully unit-testable.
 * Feed it a sliding window of recent assistant turns and it tells
 * you whether the agent is spinning in place.
 */

// ============================================================
// Types
// ============================================================

export type StuckReason =
	| "repeated-todo"
	| "repeated-next-steps"
	| "repeated-summary"
	| "no-file-changes"
	| "planning-loop"
	| "agent-waiting-on-self"

export interface TurnSummary {
	/** Plain text of all assistant text parts concatenated. */
	text: string
	/** True when the turn included any tool calls (file edits, bash runs, etc.). */
	hasToolUse: boolean
	/** True when a file was actually written/edited in this turn. */
	hasFileEdit: boolean
	/** True when a shell/bash command ran in this turn. */
	hasCommandRun: boolean
	/** Sequential turn index (0 = oldest in window). */
	index: number
}

export interface GoalState {
	originalGoal: string
	currentMilestone: string | null
	completedActions: string[]
	remainingActions: string[]
	blockers: string[]
}

export interface WatchdogAnalysis {
	isStuck: boolean
	stuckReason: StuckReason | null
	consecutivePlanningTurns: number
	lastActionableTurnIndex: number | null
	recoveryPrompt: string | null
}

// ============================================================
// Thresholds (exported so tests can reference them)
// ============================================================

export const TODO_SPAM_THRESHOLD = 3
export const PLANNING_LOOP_THRESHOLD = 4
export const NO_ACTION_THRESHOLD = 5

// ============================================================
// Text pattern detection
// ============================================================

const TODO_PATTERNS = [
	/^#{1,3}\s+(todo|to-do|to do|action items?|next steps?|remaining tasks?|what to do|implementation plan|my plan)\b/im,
	/^[-*]\s+\[\s*[x ]?\s*\]/m, // checkbox list items
	/^[-*]\s+(step \d+|phase \d+|task \d+):/im,
]

const NEXT_STEPS_PATTERNS = [
	/^#{1,3}\s+(next steps?|what'?s? next|coming up|up next)\b/im,
	/\b(here'?s? (?:my|the|our) plan|here'?s? what i('ll| will) do|i('ll| will) now|let me now|first[,]? i('ll| will))\b/i,
	/\bstep \d+[:\s]/i,
]

const SUMMARY_PATTERNS = [
	/^#{1,3}\s+(summary|recap|overview|to summarize|in summary)\b/im,
	/\b(to summarize|in summary|to recap|here'?s? a summary|let me summarize)\b/i,
]

const WAITING_ON_SELF_PATTERNS = [
	/\b(once (?:you|the user) (?:confirms?|approves?|lets? me know)|waiting for (?:your|user) (?:input|confirmation|approval|response))\b/i,
	/\b(let me know (?:if|when) you(?:'re| are) ready|please (?:confirm|let me know|tell me) (?:if|whether))\b/i,
	/\bshall i (?:proceed|continue|go ahead)\b/i,
]

export function hasTodoPlanningPattern(text: string): boolean {
	return TODO_PATTERNS.some((p) => p.test(text))
}

export function hasNextStepsPattern(text: string): boolean {
	return NEXT_STEPS_PATTERNS.some((p) => p.test(text))
}

export function hasSummaryPattern(text: string): boolean {
	return SUMMARY_PATTERNS.some((p) => p.test(text))
}

export function hasWaitingOnSelfPattern(text: string): boolean {
	return WAITING_ON_SELF_PATTERNS.some((p) => p.test(text))
}

export function isPlanningOnlyTurn(turn: TurnSummary): boolean {
	if (turn.hasToolUse || turn.hasFileEdit || turn.hasCommandRun) return false
	return (
		hasTodoPlanningPattern(turn.text) ||
		hasNextStepsPattern(turn.text) ||
		hasSummaryPattern(turn.text)
	)
}

// ============================================================
// Similarity detection (cheap trigram-based)
// ============================================================

function trigrams(text: string): Set<string> {
	const normalized = text.toLowerCase().replace(/\s+/g, " ").trim()
	const result = new Set<string>()
	for (let i = 0; i + 2 < normalized.length; i++) {
		result.add(normalized.slice(i, i + 3))
	}
	return result
}

export function textSimilarity(a: string, b: string): number {
	if (!a.trim() || !b.trim()) return 0
	const triA = trigrams(a)
	const triB = trigrams(b)
	let shared = 0
	for (const tri of triA) {
		if (triB.has(tri)) shared++
	}
	return (2 * shared) / (triA.size + triB.size)
}

/** Two messages are "essentially the same" when their trigram similarity exceeds this threshold. */
const SIMILARITY_THRESHOLD = 0.65

export function areMessagesSimilar(a: string, b: string): boolean {
	return textSimilarity(a, b) >= SIMILARITY_THRESHOLD
}

// ============================================================
// Core analysis
// ============================================================

/**
 * Analyse a sliding window of assistant turns for stuck-state indicators.
 *
 * @param turns  Recent assistant turns, oldest first.
 * @returns      Analysis with isStuck, reason, and a recovery prompt if stuck.
 */
export function analyzeSessionProgress(turns: TurnSummary[]): WatchdogAnalysis {
	if (turns.length === 0) {
		return noStuck()
	}

	// Find the last turn that had any actionable output
	let lastActionableTurnIndex: number | null = null
	for (let i = turns.length - 1; i >= 0; i--) {
		const t = turns[i]
		if (t.hasToolUse || t.hasFileEdit || t.hasCommandRun) {
			lastActionableTurnIndex = t.index
			break
		}
	}

	// Count consecutive planning-only turns from the tail
	let consecutivePlanningTurns = 0
	for (let i = turns.length - 1; i >= 0; i--) {
		if (isPlanningOnlyTurn(turns[i])) consecutivePlanningTurns++
		else break
	}

	// --- Detect: agent waiting on itself ---
	const lastTurn = turns[turns.length - 1]
	if (lastTurn && hasWaitingOnSelfPattern(lastTurn.text)) {
		return {
			isStuck: true,
			stuckReason: "agent-waiting-on-self",
			consecutivePlanningTurns,
			lastActionableTurnIndex,
			recoveryPrompt: buildRecoveryPrompt("agent-waiting-on-self"),
		}
	}

	// --- Detect: repeated TODO spam ---
	if (consecutivePlanningTurns >= TODO_SPAM_THRESHOLD) {
		const recentPlanningTurns = turns.slice(-TODO_SPAM_THRESHOLD)
		const allHaveTodo = recentPlanningTurns.every((t) => hasTodoPlanningPattern(t.text))
		if (allHaveTodo) {
			return {
				isStuck: true,
				stuckReason: "repeated-todo",
				consecutivePlanningTurns,
				lastActionableTurnIndex,
				recoveryPrompt: buildRecoveryPrompt("repeated-todo"),
			}
		}
	}

	// --- Detect: repeated "next steps" ---
	if (consecutivePlanningTurns >= TODO_SPAM_THRESHOLD) {
		const recentTurns = turns.slice(-TODO_SPAM_THRESHOLD)
		const allHaveNextSteps = recentTurns.every((t) => hasNextStepsPattern(t.text))
		if (allHaveNextSteps) {
			return {
				isStuck: true,
				stuckReason: "repeated-next-steps",
				consecutivePlanningTurns,
				lastActionableTurnIndex,
				recoveryPrompt: buildRecoveryPrompt("repeated-next-steps"),
			}
		}
	}

	// --- Detect: repeated summaries ---
	if (turns.length >= 2) {
		const last = turns[turns.length - 1]
		const prev = turns[turns.length - 2]
		if (
			hasSummaryPattern(last.text) &&
			hasSummaryPattern(prev.text) &&
			areMessagesSimilar(last.text, prev.text)
		) {
			return {
				isStuck: true,
				stuckReason: "repeated-summary",
				consecutivePlanningTurns,
				lastActionableTurnIndex,
				recoveryPrompt: buildRecoveryPrompt("repeated-summary"),
			}
		}
	}

	// --- Detect: planning loop (too many planning-only turns) ---
	if (consecutivePlanningTurns >= PLANNING_LOOP_THRESHOLD) {
		return {
			isStuck: true,
			stuckReason: "planning-loop",
			consecutivePlanningTurns,
			lastActionableTurnIndex,
			recoveryPrompt: buildRecoveryPrompt("planning-loop"),
		}
	}

	// --- Detect: no file changes in too many turns ---
	const relevantTurns = turns.slice(-NO_ACTION_THRESHOLD)
	if (
		relevantTurns.length >= NO_ACTION_THRESHOLD &&
		relevantTurns.every((t) => !t.hasFileEdit && !t.hasCommandRun)
	) {
		return {
			isStuck: true,
			stuckReason: "no-file-changes",
			consecutivePlanningTurns,
			lastActionableTurnIndex,
			recoveryPrompt: buildRecoveryPrompt("no-file-changes"),
		}
	}

	return {
		isStuck: false,
		stuckReason: null,
		consecutivePlanningTurns,
		lastActionableTurnIndex,
		recoveryPrompt: null,
	}
}

function noStuck(): WatchdogAnalysis {
	return {
		isStuck: false,
		stuckReason: null,
		consecutivePlanningTurns: 0,
		lastActionableTurnIndex: null,
		recoveryPrompt: null,
	}
}

// ============================================================
// Recovery prompts
// ============================================================

export function buildRecoveryPrompt(reason: StuckReason): string {
	switch (reason) {
		case "repeated-todo":
			return [
				"You have produced multiple TODO lists without taking any concrete action.",
				"Stop planning. Pick the single most important next action and execute it immediately.",
				"Do not explain what you are about to do. Just do it.",
			].join(" ")

		case "repeated-next-steps":
			return [
				"You keep listing next steps without completing them.",
				"Execute the first item on your next-steps list right now.",
				"Write the file, run the command, or produce the deliverable. Do not describe it.",
			].join(" ")

		case "repeated-summary":
			return [
				"You are repeating the same summary without making progress.",
				"Stop summarizing. Take one concrete action: edit a file, run a command, or produce output.",
			].join(" ")

		case "no-file-changes":
			return [
				"No files have been edited and no commands have been run in the last several turns.",
				"Make a concrete file change or run a command now. Do not plan or explain first.",
			].join(" ")

		case "planning-loop":
			return [
				"You are in a planning loop. Multiple turns have passed with no actionable output.",
				"Collapse your current plan into one concrete next action and execute it immediately.",
				"If you are blocked, state the specific blocker clearly instead of re-planning.",
			].join(" ")

		case "agent-waiting-on-self":
			return [
				"You are asking for user confirmation on a decision you can make yourself.",
				"Make the decision and proceed. Only ask the user when you genuinely lack required information.",
			].join(" ")
	}
}

// ============================================================
// Goal state tracker (lightweight, for serialization into prompts)
// ============================================================

export function formatGoalState(goal: GoalState): string {
	const lines: string[] = [`Goal: ${goal.originalGoal}`]
	if (goal.currentMilestone) lines.push(`Current milestone: ${goal.currentMilestone}`)
	if (goal.completedActions.length > 0) {
		lines.push(`Completed: ${goal.completedActions.map((a) => `✓ ${a}`).join(", ")}`)
	}
	if (goal.remainingActions.length > 0) {
		lines.push(`Remaining: ${goal.remainingActions.map((a) => `• ${a}`).join(", ")}`)
	}
	if (goal.blockers.length > 0) {
		lines.push(`Blockers: ${goal.blockers.map((b) => `⚠ ${b}`).join(", ")}`)
	}
	return lines.join("\n")
}
