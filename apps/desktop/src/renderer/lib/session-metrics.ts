/**
 * Pure utility functions for computing session timing, cost, and token metrics.
 *
 * All functions operate on SDK Message types and produce formatted strings or
 * numeric totals. No atoms or React dependencies -- safe to use anywhere.
 */

import type { ChatTurn } from "../atoms/derived/session-chat"
import type { ToolCategory } from "../components/chat/tool-card"
import type { AssistantMessage, Message, Part } from "./types"

// ============================================================
// Types
// ============================================================

export interface SessionTokens {
	input: number
	output: number
	reasoning: number
	cacheRead: number
	cacheWrite: number
	total: number
}

/** Distribution of turns across models (modelID -> count) */
export type ModelDistribution = Record<string, number>

/** Distribution of tool calls across categories (ToolCategory -> count) */
export type ToolBreakdown = Partial<Record<ToolCategory, number>>

export interface SessionMetrics {
	/** Total agent work time in milliseconds */
	workTimeMs: number
	/** Work time from completed messages only (excludes in-progress) */
	completedWorkTimeMs: number
	/** Start time (epoch ms) of the in-progress assistant message, or null if idle */
	activeStartMs: number | null
	/** Total cost in USD */
	cost: number
	/** Aggregated token counts */
	tokens: SessionTokens
	/** Number of exchanges (one exchange = one user message + all its assistant responses) */
	exchangeCount: number
	/** Number of user messages in the session */
	userMessageCount: number
	/** Number of assistant messages (LLM invocations) in the session */
	assistantMessageCount: number
	/** Map of modelID -> number of assistant messages using that model */
	modelDistribution: ModelDistribution
	/** Cache hit ratio: cacheRead / (input + cacheRead), as a percentage 0-100 */
	cacheEfficiency: number
	/** Number of assistant messages that had an error */
	errorCount: number
	/** Average cost per exchange (USD) */
	avgExchangeCost: number
	/** Average work time per exchange (ms) */
	avgExchangeTimeMs: number
}

/** Extended metrics that include parts-derived data (tool breakdown, retry count) */
export interface SessionMetricsExtended extends SessionMetrics {
	/** Tool calls by category (explore, edit, run, delegate, etc.) */
	toolBreakdown: ToolBreakdown
	/** Total number of tool calls */
	toolCallCount: number
	/** Number of retry attempts (from RetryPart) */
	retryCount: number
}

// ============================================================
// Extraction helpers
// ============================================================

function isAssistantMessage(msg: Message): msg is AssistantMessage {
	return msg.role === "assistant"
}

/** Extract all assistant messages from a mixed message array. */
export function getAssistantMessages(messages: Message[]): AssistantMessage[] {
	return messages.filter(isAssistantMessage)
}

// ============================================================
// Work time computation
// ============================================================

/**
 * Compute total agent work time across all assistant messages.
 * Sums `(completed - created)` for each assistant message that has completed.
 * Messages still in progress (no `completed` timestamp) are included with
 * `Date.now()` as the end time.
 */
export function computeAgentWorkTime(messages: Message[]): number {
	let total = 0
	for (const msg of messages) {
		if (msg.role !== "assistant") continue
		const end = msg.time.completed ?? Date.now()
		total += Math.max(0, end - msg.time.created)
	}
	return total
}

/**
 * Compute agent work time for a single turn.
 * Sums `(completed - created)` for each assistant message in the turn,
 * which is the actual agent work time (excluding gaps between messages).
 */
export function computeTurnWorkTime(turn: ChatTurn): number {
	let total = 0
	for (const entry of turn.assistantMessages) {
		if (entry.info.role !== "assistant") continue
		const end = entry.info.time.completed ?? Date.now()
		total += Math.max(0, end - entry.info.time.created)
	}
	return total
}

/**
 * Compute the completed vs in-progress work time split for a single turn.
 * Used by the LiveTurnTimer to show accurate ticking work time.
 * Returns `completedMs` (sum of finished assistant messages) and
 * `activeStartMs` (created time of the in-progress message, or null if idle).
 */
export function computeTurnWorkTimeSplit(turn: ChatTurn): {
	completedMs: number
	activeStartMs: number | null
} {
	let completedMs = 0
	let activeStartMs: number | null = null
	for (const entry of turn.assistantMessages) {
		if (entry.info.role !== "assistant") continue
		if (entry.info.time.completed != null) {
			completedMs += Math.max(0, entry.info.time.completed - entry.info.time.created)
		} else {
			activeStartMs = entry.info.time.created
		}
	}
	return { completedMs, activeStartMs }
}

/**
 * Compute the cost for a single turn by summing assistant message costs.
 */
export function computeTurnCost(turn: ChatTurn): number {
	let total = 0
	for (const entry of turn.assistantMessages) {
		if (entry.info.role === "assistant") {
			total += entry.info.cost ?? 0
		}
	}
	return total
}

// ============================================================
// Cost computation
// ============================================================

/** Sum the cost field across all assistant messages. */
export function computeSessionCost(messages: Message[]): number {
	let total = 0
	for (const msg of messages) {
		if (msg.role === "assistant") {
			total += msg.cost ?? 0
		}
	}
	return total
}

// ============================================================
// Token computation
// ============================================================

/** Sum token counts across all assistant messages. */
export function computeSessionTokens(messages: Message[]): SessionTokens {
	const result: SessionTokens = {
		input: 0,
		output: 0,
		reasoning: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	}

	for (const msg of messages) {
		if (msg.role !== "assistant") continue
		const t = msg.tokens
		if (!t) continue
		result.input += t.input ?? 0
		result.output += t.output ?? 0
		result.reasoning += t.reasoning ?? 0
		result.cacheRead += t.cache?.read ?? 0
		result.cacheWrite += t.cache?.write ?? 0
	}

	result.total =
		result.input + result.output + result.reasoning + result.cacheRead + result.cacheWrite
	return result
}

// ============================================================
// Full session metrics computation (single pass over messages)
// ============================================================

/**
 * Compute all session metrics at once (work time + cost + tokens + model
 * distribution + cache efficiency + error count + turn averages).
 * Iterates the message array only once for efficiency.
 */
export function computeSessionMetrics(messages: Message[]): SessionMetrics {
	let workTimeMs = 0
	let completedWorkTimeMs = 0
	let activeStartMs: number | null = null
	let cost = 0
	let userMessageCount = 0
	let assistantMessageCount = 0
	let errorCount = 0
	const modelDistribution: ModelDistribution = {}
	const tokens: SessionTokens = {
		input: 0,
		output: 0,
		reasoning: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	}

	// Track which user messages have at least one assistant response to count exchanges.
	// An exchange = one user message that triggered at least one assistant response.
	const userIdsWithResponses = new Set<string>()

	for (const msg of messages) {
		if (msg.role === "user") {
			userMessageCount++
			continue
		}

		// assistant message
		assistantMessageCount++

		// Track the parent user message for exchange counting
		if (msg.parentID) {
			userIdsWithResponses.add(msg.parentID)
		}

		// Work time
		const end = msg.time.completed ?? Date.now()
		workTimeMs += Math.max(0, end - msg.time.created)

		// Track completed vs in-progress for live ticking
		if (msg.time.completed != null) {
			completedWorkTimeMs += Math.max(0, msg.time.completed - msg.time.created)
		} else {
			activeStartMs = msg.time.created
		}

		// Cost
		cost += msg.cost ?? 0

		// Model distribution
		if (msg.modelID) {
			modelDistribution[msg.modelID] = (modelDistribution[msg.modelID] ?? 0) + 1
		}

		// Error count
		if (msg.error) {
			errorCount++
		}

		// Tokens
		const t = msg.tokens
		if (t) {
			tokens.input += t.input ?? 0
			tokens.output += t.output ?? 0
			tokens.reasoning += t.reasoning ?? 0
			tokens.cacheRead += t.cache?.read ?? 0
			tokens.cacheWrite += t.cache?.write ?? 0
		}
	}

	tokens.total =
		tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite

	// Cache efficiency: how much of the input was served from cache
	const totalInput = tokens.input + tokens.cacheRead
	const cacheEfficiency = totalInput > 0 ? (tokens.cacheRead / totalInput) * 100 : 0

	// Exchange count: number of user messages that got at least one assistant response.
	// Falls back to userMessageCount if parentID tracking is unavailable.
	const exchangeCount = userIdsWithResponses.size > 0 ? userIdsWithResponses.size : userMessageCount

	// Per-exchange averages
	const avgExchangeCost = exchangeCount > 0 ? cost / exchangeCount : 0
	const avgExchangeTimeMs = exchangeCount > 0 ? workTimeMs / exchangeCount : 0

	return {
		workTimeMs,
		completedWorkTimeMs,
		activeStartMs,
		cost,
		tokens,
		exchangeCount,
		userMessageCount,
		assistantMessageCount,
		modelDistribution,
		cacheEfficiency,
		errorCount,
		avgExchangeCost,
		avgExchangeTimeMs,
	}
}

// ============================================================
// Parts-derived metrics (tool breakdown + retry count)
// ============================================================

/**
 * Compute parts-derived metrics: tool usage breakdown and retry count.
 * Requires a `getCategory` function to avoid importing UI-layer code.
 *
 * @param allParts - Flat array of all parts across all messages in the session
 * @param getCategory - Maps a tool name to its ToolCategory
 */
export function computePartsMetrics(
	allParts: Part[],
	getCategory: (tool: string) => ToolCategory,
): { toolBreakdown: ToolBreakdown; toolCallCount: number; retryCount: number } {
	const toolBreakdown: ToolBreakdown = {}
	let toolCallCount = 0
	let retryCount = 0

	for (const part of allParts) {
		if (part.type === "tool") {
			toolCallCount++
			const cat = getCategory(part.tool)
			toolBreakdown[cat] = (toolBreakdown[cat] ?? 0) + 1
		} else if (part.type === "retry") {
			retryCount++
		}
	}

	return { toolBreakdown, toolCallCount, retryCount }
}

/**
 * Compute extended session metrics combining message-level and parts-level data.
 */
export function computeSessionMetricsExtended(
	messages: Message[],
	allParts: Part[],
	getCategory: (tool: string) => ToolCategory,
): SessionMetricsExtended {
	const base = computeSessionMetrics(messages)
	const partsMetrics = computePartsMetrics(allParts, getCategory)
	return { ...base, ...partsMetrics }
}

// ============================================================
// Formatters
// ============================================================

/** Format milliseconds as a compact duration string: "12s", "1m 34s", "2h 5m". */
export function formatWorkDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000)
	if (seconds < 1) return "0s"
	if (seconds < 60) return `${seconds}s`
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = seconds % 60
	if (minutes < 60) {
		return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
	}
	const hours = Math.floor(minutes / 60)
	const remainingMinutes = minutes % 60
	return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

/** Format a USD cost value: "$0.00", "$0.12", "$1.23". */
export function formatCost(cost: number): string {
	if (cost < 0.005) return "$0.00"
	return `$${cost.toFixed(2)}`
}

/** Format a token count with compact notation: "0", "1.2k", "45.3k", "1.2M". */
export function formatTokens(count: number): string {
	if (count < 1000) return `${Math.round(count)}`
	if (count < 1_000_000) {
		const k = count / 1000
		return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`
	}
	const m = count / 1_000_000
	return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`
}

/** Format a percentage: "0%", "42%", "99.5%". */
export function formatPercentage(pct: number): string {
	if (pct < 0.5) return "0%"
	if (pct >= 99.5) return "100%"
	return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`
}

/**
 * Shorten a model ID for compact display.
 * "claude-sonnet-4-20250514" -> "sonnet-4"
 * "gpt-4o-2024-08-06" -> "gpt-4o"
 * "o3-mini" -> "o3-mini"
 * Falls back to the full ID if no known pattern matches.
 */
export function shortModelName(modelID: string): string {
	if (!modelID) return ""

	// Claude models: claude-{variant}-{version}-{date}
	const claudeMatch = modelID.match(/^claude-(.+?)(-\d{8})?$/)
	if (claudeMatch) return claudeMatch[1]

	// GPT models: gpt-{variant}-{date}
	const gptMatch = modelID.match(/^(gpt-\w+?)(-\d{4}-\d{2}-\d{2})?$/)
	if (gptMatch) return gptMatch[1]

	// Gemini models: gemini-{variant}-{date}
	const geminiMatch = modelID.match(/^(gemini-[\w.-]+?)(-\d{4}-?\d{2})?$/)
	if (geminiMatch) return geminiMatch[1]

	// Generic: strip trailing date patterns (YYYYMMDD or YYYY-MM-DD)
	const genericMatch = modelID.match(/^(.+?)(-\d{8}|-\d{4}-\d{2}-\d{2})$/)
	if (genericMatch) return genericMatch[1]

	return modelID
}
