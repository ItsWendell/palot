import { describe, expect, test } from "bun:test"
import {
	createRecoveryState,
	DEFAULT_RECOVERY_CONFIG,
	evaluateRecoveryAction,
	type RecoveryConfig,
	type RecoveryState,
} from "./agent-recovery"

// ============================================================
// Helpers
// ============================================================

const BASE_CONFIG: RecoveryConfig = { ...DEFAULT_RECOVERY_CONFIG, enabled: true }
const NOW = 1_000_000_000

function state(overrides?: Partial<RecoveryState>): RecoveryState {
	return { ...createRecoveryState(), ...overrides }
}

// ============================================================
// Tests
// ============================================================

describe("createRecoveryState", () => {
	test("returns initial state with zeroed values", () => {
		const s = createRecoveryState()
		expect(s.restartCount).toBe(0)
		expect(s.lastActionAt).toBeNull()
		expect(s.lastActionType).toBeNull()
	})

	test("returns a fresh copy each call", () => {
		expect(createRecoveryState()).not.toBe(createRecoveryState())
	})
})

describe("evaluateRecoveryAction", () => {
	// ─── ACTIVE / INACTIVE: no action ───────────────────────

	test("returns null for ACTIVE sessions", () => {
		expect(evaluateRecoveryAction("ACTIVE", state(), BASE_CONFIG, NOW)).toBeNull()
	})

	test("returns null for INACTIVE sessions regardless of state", () => {
		const s = state({ restartCount: 5, lastActionAt: NOW, lastActionType: "terminate" })
		expect(evaluateRecoveryAction("INACTIVE", s, BASE_CONFIG, NOW)).toBeNull()
	})

	// ─── STALLED: restart logic ─────────────────────────────

	test("returns 'restart' for first STALLED session", () => {
		expect(evaluateRecoveryAction("STALLED", state(), BASE_CONFIG, NOW)).toBe("restart")
	})

	test("returns 'restart' for STALLED session after cooldown expires", () => {
		const s = state({
			restartCount: 1,
			lastActionAt: NOW - 310_000, // 5 min 10 sec ago — cooldown elapsed
			lastActionType: "restart",
		})
		expect(evaluateRecoveryAction("STALLED", s, BASE_CONFIG, NOW)).toBe("restart")
	})

	test("returns null for STALLED session during cooldown", () => {
		const s = state({
			restartCount: 1,
			lastActionAt: NOW - 60_000, // 1 min ago — still in cooldown
			lastActionType: "restart",
		})
		expect(evaluateRecoveryAction("STALLED", s, BASE_CONFIG, NOW)).toBeNull()
	})

	test("returns null during cooldown even at cooldown boundary", () => {
		// 4 min 59 sec — just under the 5 min threshold
		const s = state({
			restartCount: 1,
			lastActionAt: NOW - 299_000,
			lastActionType: "restart",
		})
		expect(evaluateRecoveryAction("STALLED", s, BASE_CONFIG, NOW)).toBeNull()
	})

	// ─── STALLED: max restarts exceeded → terminate ─────────

	test("returns 'terminate' for STALLED session exceeding max restarts", () => {
		const s = state({
			restartCount: 2,
			lastActionAt: NOW - 310_000, // cooldown elapsed
			lastActionType: "restart",
		})
		expect(evaluateRecoveryAction("STALLED", s, BASE_CONFIG, NOW)).toBe("terminate")
	})

	test("returns 'terminate' for STALLED session with zero restarts remaining", () => {
		const config: RecoveryConfig = { ...BASE_CONFIG, maxRestartsPerChild: 1 }
		const s = state({
			restartCount: 1,
			lastActionAt: NOW - 310_000, // cooldown elapsed
			lastActionType: "restart",
		})
		expect(evaluateRecoveryAction("STALLED", s, config, NOW)).toBe("terminate")
	})

	// ─── UNRESPONSIVE: always terminate ─────────────────────

	test("returns 'terminate' for UNRESPONSIVE session with no prior restarts", () => {
		expect(evaluateRecoveryAction("UNRESPONSIVE", state(), BASE_CONFIG, NOW)).toBe("terminate")
	})

	test("returns 'terminate' for UNRESPONSIVE session with many prior restarts", () => {
		const s = state({ restartCount: 5, lastActionAt: NOW - 5000, lastActionType: "restart" })
		expect(evaluateRecoveryAction("UNRESPONSIVE", s, BASE_CONFIG, NOW)).toBe("terminate")
	})

	test("UNRESPONSIVE bypasses cooldown check", () => {
		const s = state({
			restartCount: 0,
			lastActionAt: NOW - 1000, // 1 sec ago — would be in cooldown for restart
			lastActionType: "restart",
		})
		// Still terminates because UNRESPONSIVE always returns terminate
		expect(evaluateRecoveryAction("UNRESPONSIVE", s, BASE_CONFIG, NOW)).toBe("terminate")
	})
})
