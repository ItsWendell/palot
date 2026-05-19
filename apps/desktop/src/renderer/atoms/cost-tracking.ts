/**
 * Derived Jotai atom for aggregated per-agent cost tracking.
 *
 * Reads session metrics for all live agents and produces a sorted list of
 * cost entries plus a running total. Used by the CostTracker sidebar widget
 * to display live spend without subscribing to the full metrics family for
 * every session on every render.
 */
import { atom } from "jotai"
import { sessionMetricsFamily } from "./derived/session-metrics"
import { agentsAtom } from "./derived/agents"
import { formatCost, formatTokens } from "../lib/session-metrics"

// ============================================================
// Types
// ============================================================

export interface AgentCostEntry {
	sessionId: string
	name: string
	costRaw: number
	cost: string
	tokensRaw: number
	tokens: string
}

export interface AgentCostSummary {
	entries: AgentCostEntry[]
	totalCost: number
	totalCostFormatted: string
	totalTokens: number
	totalTokensFormatted: string
}

// ============================================================
// Atom
// ============================================================

/**
 * Aggregates cost and token data across all live agent sessions.
 * Returns entries sorted by cost descending (highest spenders first).
 * Only includes sessions that have consumed tokens.
 */
export const agentCostsAtom = (() => {
	let prev: AgentCostSummary | null = null

	return atom((get): AgentCostSummary => {
		const agents = get(agentsAtom)
		const entries: AgentCostEntry[] = []
		let totalCost = 0
		let totalTokens = 0

		for (const agent of agents) {
			const metrics = get(sessionMetricsFamily(agent.sessionId))
			if (metrics.tokensRaw === 0) continue

			entries.push({
				sessionId: agent.sessionId,
				name: agent.name,
				costRaw: metrics.costRaw,
				cost: metrics.cost,
				tokensRaw: metrics.tokensRaw,
				tokens: metrics.tokens,
			})
			totalCost += metrics.costRaw
			totalTokens += metrics.tokensRaw
		}

		entries.sort((a, b) => b.costRaw - a.costRaw)

		const next: AgentCostSummary = {
			entries,
			totalCost,
			totalCostFormatted: formatCost(totalCost),
			totalTokens,
			totalTokensFormatted: formatTokens(totalTokens),
		}

		// Structural equality to avoid re-renders when nothing changed
		if (
			prev &&
			prev.totalCost === next.totalCost &&
			prev.totalTokens === next.totalTokens &&
			prev.entries.length === next.entries.length
		) {
			return prev
		}

		prev = next
		return next
	})
})()
