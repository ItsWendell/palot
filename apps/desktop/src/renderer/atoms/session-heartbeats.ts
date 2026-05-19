/**
 * Per-session last activity timestamps recorded from SSE event arrival,
 * plus automatic recovery configuration and state for stalled child agents.
 */
import { atom } from "jotai"
import { atomFamily } from "jotai-family"
import {
	createRecoveryState,
	DEFAULT_RECOVERY_CONFIG,
	type RecoveryAction,
	type RecoveryConfig,
	type RecoveryState,
} from "../lib/agent-recovery"

export const sessionLastActivityFamily = atomFamily((_sessionId: string) => atom<number>(0))

export const recordSessionActivityAtom = atom(
	null,
	(_get, set, args: { sessionId: string; timestamp?: number }) => {
		set(sessionLastActivityFamily(args.sessionId), args.timestamp ?? Date.now())
	},
)

// ============================================================
// Auto-recovery state
// ============================================================

/** Per-parent recovery configuration (enabled, limits, cooldown). */
export const recoveryConfigFamily = atomFamily((_parentId: string) =>
	atom<RecoveryConfig>({ ...DEFAULT_RECOVERY_CONFIG }),
)

/** Per-child recovery history (restart count, last action timestamp/type). */
export const recoveryStateFamily = atomFamily((_childId: string) =>
	atom<RecoveryState>(createRecoveryState()),
)

/** Write-only atom to record a recovery action against a child session. */
export const recordRecoveryActionAtom = atom(
	null,
	(_get, set, { childId, action }: { childId: string; action: RecoveryAction }) => {
		set(recoveryStateFamily(childId), (prev) => ({
			restartCount: prev.restartCount + (action === "restart" ? 1 : 0),
			lastActionAt: Date.now(),
			lastActionType: action,
		}))
	},
)
