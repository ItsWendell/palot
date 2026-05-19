/**
 * Pure agent heartbeat and stall detection helpers.
 */
import type { AgentStatus } from "./types"

export type AgentHeartbeatStatus = "ACTIVE" | "STALLED" | "UNRESPONSIVE" | "INACTIVE"

export interface AgentHeartbeatInput {
	agentStatus: AgentStatus
	lastActivityAt: number
	now: number
	stalledAfterMs?: number
	unresponsiveAfterMs?: number
}

export interface AgentHeartbeatResult {
	status: AgentHeartbeatStatus
	idleMs: number
	canRestart: boolean
	canTerminate: boolean
	label: string
}

export const STALLED_AFTER_MS = 2 * 60 * 1000
export const UNRESPONSIVE_AFTER_MS = 5 * 60 * 1000

export function evaluateAgentHeartbeat({
	agentStatus,
	lastActivityAt,
	now,
	stalledAfterMs = STALLED_AFTER_MS,
	unresponsiveAfterMs = UNRESPONSIVE_AFTER_MS,
}: AgentHeartbeatInput): AgentHeartbeatResult {
	const idleMs = Math.max(0, now - lastActivityAt)
	if (agentStatus !== "running") {
		return {
			status: "INACTIVE",
			idleMs,
			canRestart: false,
			canTerminate: false,
			label: "Inactive",
		}
	}

	if (idleMs >= unresponsiveAfterMs) {
		return {
			status: "UNRESPONSIVE",
			idleMs,
			canRestart: true,
			canTerminate: true,
			label: "Unresponsive",
		}
	}

	if (idleMs >= stalledAfterMs) {
		return {
			status: "STALLED",
			idleMs,
			canRestart: true,
			canTerminate: true,
			label: "Stalled",
		}
	}

	return {
		status: "ACTIVE",
		idleMs,
		canRestart: false,
		canTerminate: false,
		label: "Active",
	}
}
