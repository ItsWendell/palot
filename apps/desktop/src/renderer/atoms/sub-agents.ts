/**
 * Derived atom family for per-session child (sub-agent) session data.
 *
 * Uses the existing `childrenMapAtom` parent→children map and enriches each
 * child with live metrics so the MultiAgentPanel can render without
 * subscribing to the full agents list on every update.
 */
import { atom } from "jotai"
import { atomFamily } from "jotai-family"
import { getAgentDisplayName } from "../lib/agent-progress-display"
import type { AgentStatus } from "../lib/types"
import { sessionLastActivityFamily } from "./session-heartbeats"
import { sessionFamily } from "./sessions"
import { childrenMapAtom } from "./derived/session-requests"
import { sessionMetricsFamily } from "./derived/session-metrics"

// ============================================================
// Types
// ============================================================

export interface SubAgentEntry {
	sessionId: string
	name: string
	agentStatus: AgentStatus
	activity: string | null
	model: string | null
	duration: string
	durationMs: number
	costRaw: number
	cost: string
	tokensRaw: number
	tokens: string
	toolCallCount: number
	errorCount: number
	retryCount: number
	errorMessage: string | null
	lastActivityAt: number
	directory: string
}

function getSessionErrorMessage(error: unknown): string | null {
	if (!error || typeof error !== "object") return null
	const err = error as { name?: unknown; data?: unknown }
	const name = typeof err.name === "string" ? err.name : "SessionError"
	const data = err.data
	if (data && typeof data === "object") {
		const message = (data as { message?: unknown }).message
		if (typeof message === "string" && message.trim()) return `${name}: ${message}`
	}
	return name
}

export function getPendingQuestionHeader(questions: unknown): string {
	if (!Array.isArray(questions) || questions.length === 0) return "Question"
	const first = questions[0] as { questions?: Array<{ header?: string }> } | undefined
	const header = first?.questions?.[0]?.header
	return typeof header === "string" && header.trim() ? header : "Question"
}

export function getPendingPermissionLabel(permissions: unknown): string {
	if (!Array.isArray(permissions) || permissions.length === 0) return "approval"
	const first = permissions[0] as { permission?: string } | undefined
	return typeof first?.permission === "string" && first.permission.trim()
		? first.permission
		: "approval"
}

// ============================================================
// Atom family — child sessions for a given parent
// ============================================================

/**
 * Returns live sub-agent entries for all direct children of `parentSessionId`.
 * Re-evaluates when the children map, any child's session entry, or any child's
 * metrics change. Only direct children are included (not grand-children).
 */
export const childSessionsFamily = atomFamily((parentSessionId: string) => {
	let prev: SubAgentEntry[] = []

	return atom((get): SubAgentEntry[] => {
		const childrenMap = get(childrenMapAtom)
		const childIds = childrenMap.get(parentSessionId) ?? []

		if (childIds.length === 0) {
			prev = []
			return prev
		}

		const next: SubAgentEntry[] = []

		for (const id of childIds) {
			const entry = get(sessionFamily(id))
			if (!entry) continue

			const metrics = get(sessionMetricsFamily(id))
			const { session } = entry
			const recordedActivity = get(sessionLastActivityFamily(id))
			const status = entry.status ?? { type: "idle" }
			const permissions = Array.isArray(entry.permissions) ? entry.permissions : []
			const questions = Array.isArray(entry.questions) ? entry.questions : []
			const errorMessage = getSessionErrorMessage(entry.error)

			let agentStatus: AgentStatus = "idle"
			if (permissions.length > 0 || questions.length > 0) {
				agentStatus = "waiting"
			} else if (status.type === "busy" || status.type === "retry") {
				agentStatus = "running"
			} else if (errorMessage || metrics.errorCount > 0) {
				agentStatus = "failed"
			} else if (metrics.assistantMessageCount > 0) {
				agentStatus = "completed"
			}

			let activity: string | null = null
			if (questions.length > 0) {
				activity = `Asking: ${getPendingQuestionHeader(questions)}`
			} else if (permissions.length > 0) {
				activity = `Needs approval: ${getPendingPermissionLabel(permissions)}`
			} else if (status.type === "busy") {
				activity = "Working..."
			} else if (agentStatus === "completed") {
				activity = "Returned results to Lead Agent"
			} else if (agentStatus === "failed") {
				activity = errorMessage ?? "Failed while running"
			}

			next.push({
				sessionId: id,
				name: getAgentDisplayName(session.title || "Sub-agent"),
				agentStatus,
				activity,
				model: metrics.modelDistributionDisplay[0]?.name ?? null,
				duration: metrics.workTime,
				durationMs: metrics.workTimeMs,
				costRaw: metrics.costRaw,
				cost: metrics.cost,
				tokensRaw: metrics.tokensRaw,
				tokens: metrics.tokens,
				toolCallCount: metrics.toolCallCount,
				errorCount: metrics.errorCount,
				retryCount: metrics.retryCount,
				errorMessage,
				lastActivityAt: Math.max(recordedActivity, session.time.updated, session.time.created),
				directory: entry.directory,
			})
		}

		// Structural equality: return prev if nothing changed
		if (
			next.length === prev.length &&
			next.every(
				(n, i) =>
					n.sessionId === prev[i].sessionId &&
					n.name === prev[i].name &&
					n.agentStatus === prev[i].agentStatus &&
					n.activity === prev[i].activity &&
					n.costRaw === prev[i].costRaw &&
					n.tokensRaw === prev[i].tokensRaw &&
					n.toolCallCount === prev[i].toolCallCount &&
					n.errorCount === prev[i].errorCount &&
					n.retryCount === prev[i].retryCount &&
					n.errorMessage === prev[i].errorMessage &&
					n.lastActivityAt === prev[i].lastActivityAt &&
					n.directory === prev[i].directory,
			)
		) {
			return prev
		}

		prev = next
		return next
	})
})
