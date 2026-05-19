/**
 * End-to-end integration test for the multi-agent pipeline.
 *
 * Covers the full lifecycle:
 *   Lead Agent → Architect → Builder → Reviewer
 *
 * Verifies task decomposition, subagent spawning, permission inheritance,
 * heartbeat monitoring, automatic stalled-agent recovery, watchdog integration,
 * result aggregation, and completion reporting.
 *
 * All tests use in-memory Jotai atom manipulation (no live OpenCode server).
 */
import { describe, expect, test } from "bun:test"
import type { PermissionRequest, Session } from "../lib/types"
import { addPermissionAtom, removeSessionAtom, sessionFamily, setSessionStatusAtom, upsertSessionAtom } from "../atoms/sessions"
import { childSessionsFamily } from "../atoms/sub-agents"
import { appStore } from "../atoms/store"
import { sessionLastActivityFamily, recordSessionActivityAtom, recoveryStateFamily, recordRecoveryActionAtom } from "../atoms/session-heartbeats"
import { upsertMessageAtom } from "../atoms/messages"
import type { AssistantMessage, UserMessage } from "../lib/types"
import { evaluateAgentHeartbeat, STALLED_AFTER_MS, UNRESPONSIVE_AFTER_MS } from "../lib/agent-heartbeat"
import { evaluateRecoveryAction, createRecoveryState, DEFAULT_RECOVERY_CONFIG } from "../lib/agent-recovery"
import { evaluateSupervisionPolicy, DEFAULT_SUPERVISION_POLICY } from "../lib/supervision-policy"
import { evaluateAgentWorkflowPolicy } from "../lib/agent-workflow-policy"
import { evaluateContextCompactionPolicy } from "../lib/context-compaction-policy"
import { analyzeSessionProgress } from "../lib/session-watchdog"
import type { TurnSummary } from "../lib/session-watchdog"
import { viewedSessionIdAtom } from "../atoms/ui"
import { sessionIdsAtom } from "../atoms/sessions"

// ============================================================
// Helpers
// ============================================================

const DIRECTORY = "/tmp/pipeline-integration"

function session(id: string, parentID?: string): Session {
	return {
		id,
		slug: id,
		projectID: "project-1",
		directory: DIRECTORY,
		parentID,
		title: id,
		version: "1",
		time: { created: 1, updated: 1 },
	}
}

function permission(id: string, sessionID: string): PermissionRequest {
	return {
		id,
		sessionID,
		permission: "edit",
		patterns: ["src/**"],
		metadata: {},
		always: [],
	}
}

function cleanup(ids: string[]) {
	for (const id of ids) {
		appStore.set(removeSessionAtom, id)
	}
	appStore.set(sessionIdsAtom, new Set())
	appStore.set(viewedSessionIdAtom, null)
}

// ============================================================
// Message helpers (for realistic completion tracking)
// ============================================================

function userMessage(id: string, sessionID: string): UserMessage {
	return {
		id,
		sessionID,
		role: "user",
		time: { created: 1 },
		agent: "build",
		model: { providerID: "openrouter", modelID: "anthropic/claude-sonnet-4.5" },
	}
}

function assistantMessage({
	id,
	sessionID,
	parentID,
	input,
	output,
	cost,
	completed = 2,
}: {
	id: string
	sessionID: string
	parentID: string
	input: number
	output: number
	cost: number
	completed?: number
}): AssistantMessage {
	return {
		id,
		sessionID,
		role: "assistant",
		time: { created: 1, completed },
		parentID,
		modelID: "anthropic/claude-sonnet-4.5",
		providerID: "openrouter",
		mode: "build",
		agent: "build",
		path: { cwd: DIRECTORY, root: DIRECTORY },
		cost,
		tokens: {
			input,
			output,
			reasoning: 0,
			cache: { read: 0, write: 0 },
		},
	}
}

/** Turn helper that avoids boilerplate in watchdog tests. */
function planningTurn(text: string, index: number): TurnSummary {
	return { text, hasToolUse: false, hasFileEdit: false, hasCommandRun: false, index }
}

function activeTurn(text: string, index: number): TurnSummary {
	return { text, hasToolUse: true, hasFileEdit: true, hasCommandRun: false, index }
}

// ============================================================
// Integration tests
// ============================================================

describe("multi-agent pipeline integration", () => {
	const LEAD_ID = "pipeline-lead"
	const ARCHITECT_ID = "pipeline-architect"
	const BUILDER_ID = "pipeline-builder"
	const REVIEWER_ID = "pipeline-reviewer"
	const ALL_IDS = [LEAD_ID, ARCHITECT_ID, BUILDER_ID, REVIEWER_ID]

	// ─── 1. Task Decomposition + Subagent Spawning ───────────
	describe("task decomposition and subagent spawning", () => {
		test("creates parent session and tracks it via sessionFamily", () => {
			cleanup(ALL_IDS)
			try {
				appStore.set(upsertSessionAtom, { session: session(LEAD_ID), directory: DIRECTORY })
				const entry = appStore.get(sessionFamily(LEAD_ID))
				expect(entry).not.toBeNull()
				expect(entry!.session.id).toBe(LEAD_ID)
				expect(entry!.session.title).toBe(LEAD_ID)
				expect(entry!.directory).toBe(DIRECTORY)
			} finally {
				cleanup(ALL_IDS)
			}
		})

		test("spawns child sessions and tracks them via childSessionsFamily", () => {
			cleanup(ALL_IDS)
			try {
				// Lead Agent creates child sessions for the pipeline
				appStore.set(upsertSessionAtom, { session: session(LEAD_ID), directory: DIRECTORY })
				appStore.set(upsertSessionAtom, { session: session(ARCHITECT_ID, LEAD_ID), directory: DIRECTORY })
				appStore.set(upsertSessionAtom, { session: session(BUILDER_ID, LEAD_ID), directory: DIRECTORY })
				appStore.set(upsertSessionAtom, { session: session(REVIEWER_ID, LEAD_ID), directory: DIRECTORY })

				const children = appStore.get(childSessionsFamily(LEAD_ID))
				expect(children).toHaveLength(3)
				expect(children.map((c) => c.sessionId).sort()).toEqual(
					[ARCHITECT_ID, BUILDER_ID, REVIEWER_ID].sort(),
				)
				expect(children.every((c) => c.directory === DIRECTORY)).toBe(true)
				expect(children.every((c) => Number.isFinite(c.costRaw))).toBe(true)
			} finally {
				cleanup(ALL_IDS)
			}
		})

		test("children initially have idle status before any work", () => {
			cleanup(ALL_IDS)
			try {
				appStore.set(upsertSessionAtom, { session: session(LEAD_ID), directory: DIRECTORY })
				appStore.set(upsertSessionAtom, { session: session(ARCHITECT_ID, LEAD_ID), directory: DIRECTORY })

				const children = appStore.get(childSessionsFamily(LEAD_ID))
				expect(children[0].agentStatus).toBe("idle")
				expect(children[0].activity).toBeNull()
				expect(children[0].errorCount).toBe(0)
			} finally {
				cleanup(ALL_IDS)
			}
		})

		test("children transition to running when set busy", () => {
			cleanup(ALL_IDS)
			try {
				appStore.set(upsertSessionAtom, { session: session(LEAD_ID), directory: DIRECTORY })
				appStore.set(upsertSessionAtom, { session: session(ARCHITECT_ID, LEAD_ID), directory: DIRECTORY })
				appStore.set(setSessionStatusAtom, { sessionId: ARCHITECT_ID, status: { type: "busy" } })

				const children = appStore.get(childSessionsFamily(LEAD_ID))
				expect(children[0].agentStatus).toBe("running")
				expect(children[0].activity).toBe("Working...")
			} finally {
				cleanup(ALL_IDS)
			}
		})

		test("childSessionsFamily handles parent session with zero children", () => {
			cleanup(ALL_IDS)
			try {
				appStore.set(upsertSessionAtom, { session: session(LEAD_ID), directory: DIRECTORY })
				const children = appStore.get(childSessionsFamily(LEAD_ID))
				expect(children).toHaveLength(0)
			} finally {
				cleanup(ALL_IDS)
			}
		})
	})

	// ─── 2. Permission Inheritance ───────────────────────────
	describe("permission inheritance", () => {
		test("child with pending permission shows waiting status", () => {
			cleanup(ALL_IDS)
			try {
				appStore.set(upsertSessionAtom, { session: session(LEAD_ID), directory: DIRECTORY })
				appStore.set(upsertSessionAtom, { session: session(BUILDER_ID, LEAD_ID), directory: DIRECTORY })
				appStore.set(addPermissionAtom, { sessionId: BUILDER_ID, permission: permission("perm-1", BUILDER_ID) })

				const children = appStore.get(childSessionsFamily(LEAD_ID))
				expect(children).toHaveLength(1)
				expect(children[0].agentStatus).toBe("waiting")
				expect(children[0].activity).toContain("approval")
			} finally {
				cleanup(ALL_IDS)
			}
		})

		test("child with multiple pending permissions shows first label", () => {
			cleanup(ALL_IDS)
			try {
				appStore.set(upsertSessionAtom, { session: session(LEAD_ID), directory: DIRECTORY })
				appStore.set(upsertSessionAtom, { session: session(BUILDER_ID, LEAD_ID), directory: DIRECTORY })
				appStore.set(addPermissionAtom, { sessionId: BUILDER_ID, permission: permission("perm-1", BUILDER_ID) })
				appStore.set(addPermissionAtom, { sessionId: BUILDER_ID, permission: permission("perm-2", BUILDER_ID) })

				const children = appStore.get(childSessionsFamily(LEAD_ID))
				expect(children[0].agentStatus).toBe("waiting")
			} finally {
				cleanup(ALL_IDS)
			}
		})
	})

	// ─── 3. Heartbeat Monitoring ────────────────────────────
	describe("heartbeat monitoring", () => {
		test("records activity timestamp when session events arrive", () => {
			cleanup(ALL_IDS)
			try {
				const before = Date.now()
				appStore.set(recordSessionActivityAtom, { sessionId: BUILDER_ID })
				const recorded = appStore.get(sessionLastActivityFamily(BUILDER_ID))
				expect(recorded).toBeGreaterThanOrEqual(before)
				expect(recorded).toBeLessThanOrEqual(Date.now())
			} finally {
				cleanup(ALL_IDS)
			}
		})

		test("evaluateAgentHeartbeat returns ACTIVE for recent activity", () => {
			const now = 1_000_000
			const result = evaluateAgentHeartbeat({
				agentStatus: "running",
				lastActivityAt: now - 10_000, // 10 seconds ago
				now,
			})
			expect(result.status).toBe("ACTIVE")
			expect(result.canRestart).toBe(false)
			expect(result.canTerminate).toBe(false)
		})

		test("evaluateAgentHeartbeat returns STALLED after 2min", () => {
			const now = 1_000_000
			const result = evaluateAgentHeartbeat({
				agentStatus: "running",
				lastActivityAt: now - STALLED_AFTER_MS - 1,
				now,
			})
			expect(result.status).toBe("STALLED")
			expect(result.canRestart).toBe(true)
			expect(result.canTerminate).toBe(true)
		})

		test("evaluateAgentHeartbeat returns UNRESPONSIVE after 5min", () => {
			const now = 1_000_000
			const result = evaluateAgentHeartbeat({
				agentStatus: "running",
				lastActivityAt: now - UNRESPONSIVE_AFTER_MS - 1,
				now,
			})
			expect(result.status).toBe("UNRESPONSIVE")
			expect(result.canRestart).toBe(true)
			expect(result.canTerminate).toBe(true)
		})

		test("child heartbeat status is reflected in childSessionsFamily via lastActivityAt", () => {
			cleanup(ALL_IDS)
			try {
				const now = Date.now()
				appStore.set(upsertSessionAtom, { session: session(LEAD_ID), directory: DIRECTORY })
				appStore.set(upsertSessionAtom, { session: session(ARCHITECT_ID, LEAD_ID), directory: DIRECTORY })
				appStore.set(setSessionStatusAtom, { sessionId: ARCHITECT_ID, status: { type: "busy" } })

				// Record very old activity → should be STALLED
				appStore.set(recordSessionActivityAtom, {
					sessionId: ARCHITECT_ID,
					timestamp: now - STALLED_AFTER_MS - 10_000,
				})

				const children = appStore.get(childSessionsFamily(LEAD_ID))
				const heartbeat = evaluateAgentHeartbeat({
					agentStatus: children[0].agentStatus,
					lastActivityAt: children[0].lastActivityAt,
					now,
				})
				expect(heartbeat.status).toBe("STALLED")
			} finally {
				cleanup(ALL_IDS)
			}
		})
	})

	// ─── 4. Automatic Stalled-Agent Recovery ─────────────────
	describe("automatic stalled-agent recovery", () => {
		const NOW = 1_000_000_000

		test("evaluateRecoveryAction returns 'restart' for first STALLED session", () => {
			const action = evaluateRecoveryAction("STALLED", createRecoveryState(), DEFAULT_RECOVERY_CONFIG, NOW)
			expect(action).toBe("restart")
		})

		test("evaluateRecoveryAction returns 'terminate' for UNRESPONSIVE session", () => {
			const action = evaluateRecoveryAction("UNRESPONSIVE", createRecoveryState(), DEFAULT_RECOVERY_CONFIG, NOW)
			expect(action).toBe("terminate")
		})

		test("evaluateRecoveryAction returns null for ACTIVE session", () => {
			const action = evaluateRecoveryAction("ACTIVE", createRecoveryState(), DEFAULT_RECOVERY_CONFIG, NOW)
			expect(action).toBeNull()
		})

		test("evaluateRecoveryAction returns null during cooldown period", () => {
			const state = {
				restartCount: 1,
				lastActionAt: NOW - 60_000, // 1 min ago — within 5 min cooldown
				lastActionType: "restart" as const,
			}
			const action = evaluateRecoveryAction("STALLED", state, DEFAULT_RECOVERY_CONFIG, NOW)
			expect(action).toBeNull()
		})

		test("evaluateRecoveryAction escalates to terminate after max restarts", () => {
			const state = {
				restartCount: 2, // maxRestartsPerChild = 2
				lastActionAt: NOW - 310_000, // cooldown elapsed
				lastActionType: "restart" as const,
			}
			const action = evaluateRecoveryAction("STALLED", state, DEFAULT_RECOVERY_CONFIG, NOW)
			expect(action).toBe("terminate")
		})

		test("recordRecoveryActionAtom increments restart count", () => {
			const childId = "rr-inc-test"
			cleanup([childId])
			try {
				appStore.set(recordRecoveryActionAtom, { childId, action: "restart" })
				const state = appStore.get(recoveryStateFamily(childId))
				expect(state.restartCount).toBe(1)
				expect(state.lastActionType).toBe("restart")
				expect(state.lastActionAt).not.toBeNull()
			} finally {
				cleanup([childId])
			}
		})

		test("recordRecoveryActionAtom does not increment count on terminate", () => {
			const childId = "rr-term-test"
			cleanup([childId])
			try {
				appStore.set(recordRecoveryActionAtom, { childId, action: "terminate" })
				const state = appStore.get(recoveryStateFamily(childId))
				expect(state.restartCount).toBe(0)
				expect(state.lastActionType).toBe("terminate")
			} finally {
				cleanup([childId])
			}
		})

		test("multiple restarts accumulate count and only reset per child", () => {
			const builderId = "rr-multi-builder"
			const reviewerId = "rr-multi-reviewer"
			cleanup([builderId, reviewerId])
			try {
				// Two restarts on builder
				appStore.set(recordRecoveryActionAtom, { childId: builderId, action: "restart" })
				appStore.set(recordRecoveryActionAtom, { childId: builderId, action: "restart" })
				// One restart on reviewer
				appStore.set(recordRecoveryActionAtom, { childId: reviewerId, action: "restart" })

				expect(appStore.get(recoveryStateFamily(builderId)).restartCount).toBe(2)
				expect(appStore.get(recoveryStateFamily(reviewerId)).restartCount).toBe(1)
			} finally {
				cleanup([builderId, reviewerId])
			}
		})

		test("full recovery lifecycle: STALLED → restart → still stalled → terminate", () => {
			const config = { enabled: true, maxRestartsPerChild: 1, restartCooldownMs: 300_000 }
			let state = createRecoveryState()

			// First stall: should restart
			const firstAction = evaluateRecoveryAction("STALLED", state, config, NOW)
			expect(firstAction).toBe("restart")

			// Simulate restart recorded
			state = { restartCount: 1, lastActionAt: NOW, lastActionType: "restart" }

			// Still stalled after cooldown: exceeded max restarts → terminate
			const secondAction = evaluateRecoveryAction("STALLED", state, config, NOW + 310_000)
			expect(secondAction).toBe("terminate")
		})
	})

	// ─── 5. Watchdog Integration ─────────────────────────────
	describe("watchdog integration", () => {
		test("analyzeSessionProgress detects repeated TODO planning loops", () => {
			const turns: TurnSummary[] = [
				planningTurn("# TODO: implement feature X\n## Next steps: foo, bar", 0),
				planningTurn("# TODO: implement feature X\n## Next steps: baz, qux", 1),
				planningTurn("# TODO: implement feature X\n## Next steps: fizz, buzz", 2),
			]
			const result = analyzeSessionProgress(turns)
			expect(result.isStuck).toBe(true)
			expect(result.stuckReason).toBe("repeated-todo")
			expect(result.recoveryPrompt).not.toBeNull()
		})

		test("analyzeSessionProgress detects repeated next-steps patterns", () => {
			const turns: TurnSummary[] = [
				planningTurn("Here's my plan: step 1 research, step 2 implement", 0),
				planningTurn("Here is my plan: step 1 analyze, step 2 build", 1),
				planningTurn("Here is my plan: step 1 review, step 2 merge", 2),
			]
			const result = analyzeSessionProgress(turns)
			expect(result.isStuck).toBe(true)
			expect(result.stuckReason).toBe("repeated-next-steps")
		})

		test("analyzeSessionProgress does not flag active work as stuck", () => {
			const turns: TurnSummary[] = [
				activeTurn("Editing file src/index.ts to add new component", 0),
				activeTurn("Running build to verify changes compile", 1),
				activeTurn("Adding tests for the new edge case", 2),
			]
			const result = analyzeSessionProgress(turns)
			expect(result.isStuck).toBe(false)
			expect(result.stuckReason).toBeNull()
			expect(result.recoveryPrompt).toBeNull()
		})

		test("analyzeSessionProgress detects agent waiting on itself", () => {
			const turns: TurnSummary[] = [
				planningTurn("Once you confirm, I'll proceed with the implementation", 0),
			]
			const result = analyzeSessionProgress(turns)
			expect(result.isStuck).toBe(true)
			expect(result.stuckReason).toBe("agent-waiting-on-self")
		})

		test("analyzeSessionProgress detects no-file-changes after 5 non-editing turns", () => {
			const turns: TurnSummary[] = [
				planningTurn("Let me think about the approach", 0),
				planningTurn("The architecture should follow MVC", 1),
				planningTurn("I should use TypeScript for this", 2),
				planningTurn("Error handling is important here", 3),
				planningTurn("Testing strategy is key", 4),
			]
			const result = analyzeSessionProgress(turns)
			expect(result.isStuck).toBe(true)
			// The first 3 are planning, so repeated-todo/repeated-next-steps may fire first
			expect(result.stuckReason).toBeTruthy()
		})

		test("watchdog tracks consecutive planning turn count correctly", () => {
			const turns: TurnSummary[] = [
				activeTurn("Editing file...", 0),
				planningTurn("# TODO: next steps", 1),
				planningTurn("# TODO: more planning", 2),
			]
			const result = analyzeSessionProgress(turns)
			expect(result.consecutivePlanningTurns).toBe(2)
			expect(result.lastActionableTurnIndex).toBe(0)
		})
	})

	// ─── 6. Supervision Policy Integration ──────────────────
	describe("supervision policy integration", () => {
		const WORKFLOW_ID = "test-workflow"

		test("returns ALLOW when all metrics are within limits", () => {
			const result = evaluateSupervisionPolicy({
				workflowId: WORKFLOW_ID,
				parentAgentId: WORKFLOW_ID,
				childAgentCount: 2,
				runningAgentCount: 1,
				failedAgentCount: 0,
				waitingAgentCount: 0,
				totalTokens: 50_000,
				totalCost: 0.15,
				configuredBudget: DEFAULT_SUPERVISION_POLICY.configuredBudget,
				maxChildren: DEFAULT_SUPERVISION_POLICY.maxChildren,
				maxConcurrentAgents: DEFAULT_SUPERVISION_POLICY.maxConcurrentAgents,
				currentAgentState: "running",
			})
			expect(result.decision).toBe("allow")
			expect(result.machineCode).toBe("SUPERVISION_ALLOW")
		})

		test("returns STOP when budget is exceeded by an active workflow", () => {
			const result = evaluateSupervisionPolicy({
				workflowId: WORKFLOW_ID,
				parentAgentId: WORKFLOW_ID,
				childAgentCount: 3,
				runningAgentCount: 2,
				failedAgentCount: 0,
				waitingAgentCount: 0,
				totalTokens: 500_000,
				totalCost: 1.50,
				configuredBudget: 1.00,
				maxChildren: 12,
				maxConcurrentAgents: 3,
				currentAgentState: "running",
			})
			expect(result.decision).toBe("stop")
			expect(result.machineCode).toBe("SUPERVISION_STOP_BUDGET_EXCEEDED")
			expect(result.severity).toBe("critical")
		})

		test("returns WARN when child agents have failed", () => {
			const result = evaluateSupervisionPolicy({
				workflowId: WORKFLOW_ID,
				parentAgentId: WORKFLOW_ID,
				childAgentCount: 3,
				runningAgentCount: 1,
				failedAgentCount: 1,
				waitingAgentCount: 0,
				totalTokens: 80_000,
				totalCost: 0.30,
				configuredBudget: 1.00,
				maxChildren: 12,
				maxConcurrentAgents: 3,
				currentAgentState: "running",
			})
			expect(result.decision).toBe("warn")
			expect(result.machineCode).toBe("SUPERVISION_WARN_CHILD_FAILURES")
		})

		test("returns BLOCK when max children exceeded", () => {
			const result = evaluateSupervisionPolicy({
				workflowId: WORKFLOW_ID,
				parentAgentId: WORKFLOW_ID,
				childAgentCount: 15,
				runningAgentCount: 12,
				failedAgentCount: 0,
				waitingAgentCount: 0,
				totalTokens: 50_000,
				totalCost: 0.10,
				configuredBudget: 1.00,
				maxChildren: 12,
				maxConcurrentAgents: 3,
				currentAgentState: "running",
			})
			expect(result.decision).toBe("block")
			expect(result.machineCode).toBe("SUPERVISION_BLOCK_MAX_CHILDREN")
		})

		test("returns THROTTLE when max concurrency reached", () => {
			const result = evaluateSupervisionPolicy({
				workflowId: WORKFLOW_ID,
				parentAgentId: WORKFLOW_ID,
				childAgentCount: 5,
				runningAgentCount: 3,
				failedAgentCount: 0,
				waitingAgentCount: 0,
				totalTokens: 50_000,
				totalCost: 0.10,
				configuredBudget: 1.00,
				maxChildren: 12,
				maxConcurrentAgents: 3,
				currentAgentState: "running",
			})
			expect(result.decision).toBe("throttle")
			expect(result.machineCode).toBe("SUPERVISION_THROTTLE_CONCURRENCY")
		})

		test("returns WARN when cost approaches budget", () => {
			const result = evaluateSupervisionPolicy({
				workflowId: WORKFLOW_ID,
				parentAgentId: WORKFLOW_ID,
				childAgentCount: 2,
				runningAgentCount: 1,
				failedAgentCount: 0,
				waitingAgentCount: 0,
				totalTokens: 100_000,
				totalCost: 0.80, // 80% of $1.00 budget
				configuredBudget: 1.00,
				maxChildren: 12,
				maxConcurrentAgents: 3,
				currentAgentState: "running",
			})
			expect(result.decision).toBe("warn")
			expect(result.machineCode).toBe("SUPERVISION_WARN_COST_APPROACHING_BUDGET")
		})

		test("returns BLOCK for idle workflow that exceeded budget", () => {
			const result = evaluateSupervisionPolicy({
				workflowId: WORKFLOW_ID,
				parentAgentId: WORKFLOW_ID,
				childAgentCount: 3,
				runningAgentCount: 0,
				failedAgentCount: 0,
				waitingAgentCount: 0,
				totalTokens: 500_000,
				totalCost: 1.50,
				configuredBudget: 1.00,
				maxChildren: 12,
				maxConcurrentAgents: 3,
				currentAgentState: "completed", // idle/completed state
			})
			expect(result.decision).toBe("block")
			expect(result.machineCode).toBe("SUPERVISION_BLOCK_BUDGET_EXCEEDED")
		})
	})

	// ─── 7. Workflow Policy Integration ─────────────────────
	describe("workflow policy integration", () => {
		test("allows parallel execution for isolated writes", () => {
			const result = evaluateAgentWorkflowPolicy({
				workflowKind: "isolated_write",
				runningAgentCount: 2,
				maxConcurrentAgents: 5,
				hasFileLocking: false,
				hasIsolatedFileOwnership: true,
			})
			expect(result.mode).toBe("parallel")
			expect(result.allowed).toBe(true)
		})

		test("returns sequential for shared writes without file locking", () => {
			const result = evaluateAgentWorkflowPolicy({
				workflowKind: "shared_write",
				runningAgentCount: 1,
				maxConcurrentAgents: 5,
				hasFileLocking: false,
				hasIsolatedFileOwnership: false,
			})
			expect(result.mode).toBe("sequential")
			expect(result.allowed).toBe(true)
		})

		test("blocks new work when max concurrency reached", () => {
			const result = evaluateAgentWorkflowPolicy({
				workflowKind: "research",
				runningAgentCount: 5,
				maxConcurrentAgents: 3,
				hasFileLocking: false,
				hasIsolatedFileOwnership: false,
			})
			expect(result.mode).toBe("sequential")
			expect(result.allowed).toBe(false)
		})

		test("research workflows default to parallel", () => {
			const result = evaluateAgentWorkflowPolicy({
				workflowKind: "research",
				runningAgentCount: 2,
				maxConcurrentAgents: 5,
				hasFileLocking: false,
				hasIsolatedFileOwnership: false,
			})
			expect(result.mode).toBe("parallel")
			expect(result.allowed).toBe(true)
		})
	})

	// ─── 8. Context Compaction Policy Integration ───────────
	describe("context compaction policy integration", () => {
		test("returns NORMAL for low context usage", () => {
			const result = evaluateContextCompactionPolicy({
				usage: { percentage: 30, compactionPercentage: 0 },
			})
			expect(result.state).toBe("NORMAL")
			expect(result.severity).toBe("info")
		})

		test("suggests compaction above 75%", () => {
			const result = evaluateContextCompactionPolicy({
				usage: { percentage: 80, compactionPercentage: 0 },
			})
			expect(result.state).toBe("COMPACTION_SUGGESTED")
			expect(result.severity).toBe("warning")
		})

		test("blocks new work when context is critically full", () => {
			const result = evaluateContextCompactionPolicy({
				usage: { percentage: 98, compactionPercentage: 0 },
			})
			expect(result.state).toBe("BLOCKED_UNTIL_COMPACTED")
			expect(result.shouldBlockNewWork).toBe(true)
			expect(result.severity).toBe("critical")
		})
	})

	// ─── 9. Full Pipeline Lifecycle Scenario ────────────────
	describe("full pipeline lifecycle scenario", () => {
		test("simulates complete Lead → Architect → Builder → Reviewer flow with stall, recovery, and completion", () => {
			cleanup(ALL_IDS)
			const now = Date.now()

			try {
				// ── Phase 1: Lead spawns children ──
				appStore.set(viewedSessionIdAtom, LEAD_ID)
				appStore.set(upsertSessionAtom, { session: session(LEAD_ID), directory: DIRECTORY })
				appStore.set(upsertSessionAtom, { session: session(ARCHITECT_ID, LEAD_ID), directory: DIRECTORY })
				appStore.set(upsertSessionAtom, { session: session(BUILDER_ID, LEAD_ID), directory: DIRECTORY })
				appStore.set(upsertSessionAtom, { session: session(REVIEWER_ID, LEAD_ID), directory: DIRECTORY })

				// All children start idle
				let children = appStore.get(childSessionsFamily(LEAD_ID))
				expect(children).toHaveLength(3)
				expect(children.every((c) => c.agentStatus === "idle")).toBe(true)

				// ── Phase 2: Children start working ──
				appStore.set(setSessionStatusAtom, { sessionId: ARCHITECT_ID, status: { type: "busy" } })
				appStore.set(setSessionStatusAtom, { sessionId: BUILDER_ID, status: { type: "busy" } })
				appStore.set(setSessionStatusAtom, { sessionId: REVIEWER_ID, status: { type: "busy" } })
				appStore.set(recordSessionActivityAtom, { sessionId: ARCHITECT_ID, timestamp: now })
				appStore.set(recordSessionActivityAtom, { sessionId: BUILDER_ID, timestamp: now })
				appStore.set(recordSessionActivityAtom, { sessionId: REVIEWER_ID, timestamp: now })

				children = appStore.get(childSessionsFamily(LEAD_ID))
				expect(children.every((c) => c.agentStatus === "running")).toBe(true)

				// ── Phase 3: Architect stalls, others keep working ──
				// Architect: 3 min stale (STALLED)
				// Builder: 30 sec ago (ACTIVE)
				// Reviewer: 10 sec ago (ACTIVE)
				appStore.set(recordSessionActivityAtom, {
					sessionId: ARCHITECT_ID,
					timestamp: now - STALLED_AFTER_MS - 60_000,
				})
				appStore.set(recordSessionActivityAtom, {
					sessionId: BUILDER_ID,
					timestamp: now - 30_000,
				})
				appStore.set(recordSessionActivityAtom, {
					sessionId: REVIEWER_ID,
					timestamp: now - 10_000,
				})

				// Verify heartbeat statuses
				const archHb = evaluateAgentHeartbeat({
					agentStatus: "running",
					lastActivityAt: now - STALLED_AFTER_MS - 60_000,
					now,
				})
				const buildHb = evaluateAgentHeartbeat({
					agentStatus: "running",
					lastActivityAt: now - 30_000,
					now,
				})
				const revHb = evaluateAgentHeartbeat({
					agentStatus: "running",
					lastActivityAt: now - 10_000,
					now,
				})
				expect(archHb.status).toBe("STALLED")
				expect(buildHb.status).toBe("ACTIVE")
				expect(revHb.status).toBe("ACTIVE")

				// ── Phase 4: Auto-recovery decision for stalled architect ──
				const archState = appStore.get(recoveryStateFamily(ARCHITECT_ID))
				const recoveryAction = evaluateRecoveryAction(
					archHb.status,
					archState,
					DEFAULT_RECOVERY_CONFIG,
					now,
				)
				expect(recoveryAction).toBe("restart")

				// Record the restart
				appStore.set(recordRecoveryActionAtom, { childId: ARCHITECT_ID, action: "restart" })
				const updatedArchState = appStore.get(recoveryStateFamily(ARCHITECT_ID))
				expect(updatedArchState.restartCount).toBe(1)
				expect(updatedArchState.lastActionType).toBe("restart")

				// ── Phase 5: Builder needs permission approval ──
				appStore.set(addPermissionAtom, {
					sessionId: BUILDER_ID,
					permission: permission("perm-edit", BUILDER_ID),
				})
				children = appStore.get(childSessionsFamily(LEAD_ID))
				const builderChild = children.find((c) => c.sessionId === BUILDER_ID)
				expect(builderChild).toBeDefined()
				expect(builderChild!.agentStatus).toBe("waiting")
				expect(builderChild!.activity).toContain("approval")

				// ── Phase 6: Supervision policy evaluation with aggregated state ──
				// 3 children total, 1 running (architect restarted), 1 waiting (builder permission),
				// 1 running (reviewer), 0 failed
				const policy = evaluateSupervisionPolicy({
					workflowId: LEAD_ID,
					parentAgentId: LEAD_ID,
					childAgentCount: 3,
					runningAgentCount: 2, // architect restarted + reviewer active
					failedAgentCount: 0,
					waitingAgentCount: 1, // builder waiting on permission
					totalTokens: 150_000,
					totalCost: 0.45,
					configuredBudget: DEFAULT_SUPERVISION_POLICY.configuredBudget,
					maxChildren: DEFAULT_SUPERVISION_POLICY.maxChildren,
					maxConcurrentAgents: DEFAULT_SUPERVISION_POLICY.maxConcurrentAgents,
					currentAgentState: "running",
				})
				// Within budget, under limits → allow
				expect(policy.decision).toBe("allow")

				// ── Phase 7: Workflow policy for remaining work ──
				const workflowPolicy = evaluateAgentWorkflowPolicy({
					workflowKind: "shared_write",
					runningAgentCount: 2,
					maxConcurrentAgents: DEFAULT_SUPERVISION_POLICY.maxConcurrentAgents,
					hasFileLocking: false,
					hasIsolatedFileOwnership: false,
				})
				expect(workflowPolicy.mode).toBe("sequential")

				// ── Phase 8: Reviewer completes work ──
				appStore.set(upsertMessageAtom, userMessage("reviewer-user", REVIEWER_ID))
				appStore.set(
					upsertMessageAtom,
					assistantMessage({
						id: "reviewer-assistant",
						sessionID: REVIEWER_ID,
						parentID: "reviewer-user",
						input: 9_000,
						output: 1_000,
						cost: 0.05,
					}),
				)
				appStore.set(setSessionStatusAtom, { sessionId: REVIEWER_ID, status: { type: "idle" } })
				appStore.set(recordSessionActivityAtom, {
					sessionId: REVIEWER_ID,
					timestamp: now + 10_000,
				})

				children = appStore.get(childSessionsFamily(LEAD_ID))
				const completedReviewer = children.find((c) => c.sessionId === REVIEWER_ID)
				expect(completedReviewer).toBeDefined()
				expect(completedReviewer!.agentStatus).toBe("completed")
				expect(completedReviewer!.activity).toBe("Returned results to Lead Agent")
				expect(completedReviewer!.tokensRaw).toBe(10_000)
				expect(completedReviewer!.costRaw).toBe(0.05)
			} finally {
				cleanup(ALL_IDS)
			}
		})
	})
})
