/**
 * Pure recovery decision logic for stalled/unresponsive child sessions.
 *
 * Determines whether to automatically restart or terminate a child agent
 * based on its heartbeat status, recovery history, and configured limits.
 * All functions are side-effect-free for testability.
 */
import type { AgentHeartbeatStatus } from "./agent-heartbeat"

// ============================================================
// Types
// ============================================================

export interface RecoveryConfig {
	enabled: boolean
	maxRestartsPerChild: number
	restartCooldownMs: number
}

export interface RecoveryState {
	restartCount: number
	lastActionAt: number | null
	lastActionType: "restart" | "terminate" | null
}

export type RecoveryAction = "restart" | "terminate"

// ============================================================
// Constants
// ============================================================

export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
	enabled: true,
	maxRestartsPerChild: 2,
	restartCooldownMs: 5 * 60 * 1000, // 5 minutes
}

/** Prompt sent to a child agent after a successful abort to restart it. */
export const RESTART_PROMPT =
	"Restart from the last known objective. Summarize current state first, then continue with the next safe step."

const INITIAL_STATE: RecoveryState = {
	restartCount: 0,
	lastActionAt: null,
	lastActionType: null,
}

// ============================================================
// Helpers
// ============================================================

export function createRecoveryState(): RecoveryState {
	return { ...INITIAL_STATE }
}

// ============================================================
// Decision function
// ============================================================

/**
 * Decide what recovery action (if any) to take for a child session.
 *
 * Returns `null` if no action is needed:
 * - Session is ACTIVE or INACTIVE (no stall)
 * - Session is STALLED but still within the cooldown period
 *
 * Returns `"restart"` if:
 * - Session is STALLED, restart count is under the limit, and cooldown has elapsed
 *
 * Returns `"terminate"` if:
 * - Session is UNRESPONSIVE (too far gone for a simple restart)
 * - Session is STALLED and has exceeded the maximum restart count
 */
export function evaluateRecoveryAction(
	heartbeatStatus: AgentHeartbeatStatus,
	state: RecoveryState,
	config: RecoveryConfig,
	now: number,
): RecoveryAction | null {
	if (heartbeatStatus === "ACTIVE" || heartbeatStatus === "INACTIVE") {
		return null
	}

	// Unresponsive sessions are always terminated immediately
	if (heartbeatStatus === "UNRESPONSIVE") {
		return "terminate"
	}

	// STALLED sessions
	if (state.restartCount >= config.maxRestartsPerChild) {
		return "terminate"
	}

	// Check cooldown: don't restart too frequently
	if (state.lastActionAt !== null) {
		const elapsed = now - state.lastActionAt
		if (elapsed < config.restartCooldownMs) {
			return null
		}
	}

	return "restart"
}
