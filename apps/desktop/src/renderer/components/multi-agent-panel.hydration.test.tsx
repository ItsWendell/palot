import { mock, describe, expect, test } from "bun:test"
import { Provider } from "jotai"
import { renderToString } from "react-dom/server"
import type {
	AssistantMessage,
	PermissionRequest,
	QuestionRequest,
	Session,
	SessionStatus,
	UserMessage,
} from "../lib/types"
import {
	addPermissionAtom,
	addQuestionAtom,
	removeSessionAtom,
	sessionFamily,
	sessionIdsAtom,
	setSessionStatusAtom,
	upsertSessionAtom,
	type SessionEntry,
} from "../atoms/sessions"
import { upsertMessageAtom } from "../atoms/messages"
import { sessionMetricsFamily } from "../atoms/derived/session-metrics"
import { recordSessionActivityAtom } from "../atoms/session-heartbeats"
import { viewedSessionIdAtom } from "../atoms/ui"
import { appStore } from "../atoms/store"
import { childSessionsFamily } from "../atoms/sub-agents"
import { evaluateAgentWorkflowPolicy } from "../lib/agent-workflow-policy"
import { evaluateContextCompactionPolicy } from "../lib/context-compaction-policy"
import { STALLED_AFTER_MS, UNRESPONSIVE_AFTER_MS } from "../lib/agent-heartbeat"
import { computeContextUsage } from "../lib/session-metrics"
import { DEFAULT_SUPERVISION_POLICY, evaluateSupervisionPolicy } from "../lib/supervision-policy"

mock.module("@tanstack/react-router", () => ({
	useNavigate: () => () => undefined,
	useParams: () => ({ projectSlug: "palot-test" }),
}))

const { MultiAgentPanel } = await import("./multi-agent-panel")

const DIRECTORY = "/tmp/palot-sse-hydration"

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

function question(id: string, sessionID: string): QuestionRequest {
	return {
		id,
		sessionID,
		questions: [
			{
				question: "Choose a strategy",
				header: "Strategy",
				options: [{ label: "Research", description: "Gather context first" }],
			},
		],
	}
}

function permission(id: string, sessionID: string): PermissionRequest {
	return {
		id,
		sessionID,
		permission: "edit",
		patterns: ["apps/**"],
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

describe("SSE child-agent hydration", () => {
	test("hydrates out-of-order partial child events without crashing Hive Mind", () => {
		const parentID = "hydration-parent"
		const architectID = "hydration-child-architect"
		const builderID = "hydration-child-builder"
		const reviewerID = "hydration-child-reviewer"
		const ids = [parentID, architectID, builderID, reviewerID]
		cleanup(ids)

		try {
			appStore.set(viewedSessionIdAtom, parentID)

			// Child appears before parent metadata, with token/cost data already streamed.
			appStore.set(upsertSessionAtom, { session: session(architectID, parentID), directory: DIRECTORY })
			appStore.set(upsertMessageAtom, userMessage("architect-user", architectID))
			appStore.set(
				upsertMessageAtom,
				assistantMessage({
					id: "architect-assistant",
					sessionID: architectID,
					parentID: "architect-user",
					input: 18_000,
					output: 2_000,
					cost: 0.12,
				}),
			)

			// Partial question object: missing nested question info that previously crashed.
			const architectEntry = appStore.get(sessionFamily(architectID))
			expect(architectEntry).not.toBeNull()
			appStore.set(sessionFamily(architectID), {
				...architectEntry!,
				questions: [{ id: "partial-question", sessionID: architectID } as QuestionRequest],
			})
			expect(() => appStore.get(childSessionsFamily(parentID))).not.toThrow()

			// Parent arrives after the first child.
			appStore.set(upsertSessionAtom, { session: session(parentID), directory: DIRECTORY })
			appStore.set(upsertMessageAtom, userMessage("parent-user", parentID))
			appStore.set(
				upsertMessageAtom,
				assistantMessage({
					id: "parent-assistant",
					sessionID: parentID,
					parentID: "parent-user",
					input: 110_000,
					output: 4_000,
					cost: 0.2,
					completed: 4,
				}),
			)

			// Missing permissions and missing status fields from a partially hydrated child entry.
			appStore.set(upsertSessionAtom, { session: session(builderID, parentID), directory: DIRECTORY })
			const builderEntry = appStore.get(sessionFamily(builderID))
			expect(builderEntry).not.toBeNull()
			appStore.set(sessionFamily(builderID), {
				...builderEntry!,
				status: undefined as unknown as SessionStatus,
				permissions: undefined as unknown as SessionEntry["permissions"],
			})

			// Interleaved updates: builder gets a real permission and metrics, architect becomes busy.
			appStore.set(addPermissionAtom, { sessionId: builderID, permission: permission("perm-1", builderID) })
			appStore.set(upsertMessageAtom, userMessage("builder-user", builderID))
			appStore.set(
				upsertMessageAtom,
				assistantMessage({
					id: "builder-assistant",
					sessionID: builderID,
					parentID: "builder-user",
					input: 23_000,
					output: 3_000,
					cost: 0.18,
				}),
			)
			appStore.set(setSessionStatusAtom, { sessionId: architectID, status: { type: "busy" } })

			// Third child arrives late with a complete question.
			appStore.set(upsertSessionAtom, { session: session(reviewerID, parentID), directory: DIRECTORY })
			appStore.set(addQuestionAtom, { sessionId: reviewerID, question: question("question-1", reviewerID) })
			appStore.set(upsertMessageAtom, userMessage("reviewer-user", reviewerID))
			appStore.set(
				upsertMessageAtom,
				assistantMessage({
					id: "reviewer-assistant",
					sessionID: reviewerID,
					parentID: "reviewer-user",
					input: 9_000,
					output: 1_000,
					cost: 0.05,
				}),
			)

			const children = appStore.get(childSessionsFamily(parentID))
			expect(children.map((child) => child.sessionId).sort()).toEqual(
				[architectID, builderID, reviewerID].sort(),
			)
			expect(children.every((child) => Number.isFinite(child.costRaw))).toBe(true)
			expect(children.every((child) => Number.isFinite(child.tokensRaw))).toBe(true)

			const parentMetrics = appStore.get(sessionMetricsFamily(parentID))
			const childMetrics = appStore.get(sessionMetricsFamily(builderID))
			expect(parentMetrics.tokensRaw).toBe(114_000)
			expect(childMetrics.costRaw).toBe(0.18)

			const totalCost = parentMetrics.costRaw + children.reduce((sum, child) => sum + child.costRaw, 0)
			const totalTokens =
				parentMetrics.tokensRaw + children.reduce((sum, child) => sum + child.tokensRaw, 0)
			const supervision = evaluateSupervisionPolicy({
				workflowId: parentID,
				parentAgentId: parentID,
				childAgentCount: children.length,
				runningAgentCount: children.filter((child) => child.agentStatus === "running").length,
				failedAgentCount: children.filter((child) => child.agentStatus === "failed").length,
				waitingAgentCount: children.filter((child) => child.agentStatus === "waiting").length,
				totalTokens,
				totalCost: Math.max(
					totalCost,
					DEFAULT_SUPERVISION_POLICY.configuredBudget *
						DEFAULT_SUPERVISION_POLICY.budgetWarningRatio,
				),
				configuredBudget: DEFAULT_SUPERVISION_POLICY.configuredBudget,
				maxChildren: DEFAULT_SUPERVISION_POLICY.maxChildren,
				maxConcurrentAgents: DEFAULT_SUPERVISION_POLICY.maxConcurrentAgents,
				currentAgentState: "running",
			})
			expect(supervision.machineCode).not.toBe("SUPERVISION_ALLOW")

			const contextUsage = computeContextUsage(
				[userMessage("context-user", parentID), assistantMessage({
					id: "context-assistant",
					sessionID: parentID,
					parentID: "context-user",
					input: 92_000,
					output: 4_000,
					cost: 0.2,
				})],
				() => ({ context: 160_000, input: 140_000, output: 8_000 }),
				{ auto: true, reserved: 20_000 },
			)
			const contextPolicy = evaluateContextCompactionPolicy({ usage: contextUsage })
			expect(contextPolicy.state).toBe("COMPACTION_SUGGESTED")

			const workflowPolicy = evaluateAgentWorkflowPolicy({
				workflowKind: "shared_write",
				runningAgentCount: children.filter((child) => child.agentStatus === "running").length,
				maxConcurrentAgents: DEFAULT_SUPERVISION_POLICY.maxConcurrentAgents,
				hasFileLocking: false,
				hasIsolatedFileOwnership: false,
			})
			expect(workflowPolicy.mode).toBe("sequential")

			expect(() =>
				renderToString(
					<Provider store={appStore}>
						<MultiAgentPanel parentSessionId={parentID} />
					</Provider>,
				),
			).not.toThrow()
			const html = renderToString(
				<Provider store={appStore}>
					<MultiAgentPanel parentSessionId={parentID} />
				</Provider>,
			)
			expect(html).toContain("Hive Mind")
			expect(html).toContain("Execution")
			expect(html).toContain("Session spend")
		} finally {
			cleanup(ids)
		}
	})

	test("renders stalled and unresponsive heartbeat controls for busy child agents", () => {
		const parentID = "heartbeat-parent"
		const stalledID = "heartbeat-stalled-child"
		const unresponsiveID = "heartbeat-unresponsive-child"
		const ids = [parentID, stalledID, unresponsiveID]
		cleanup(ids)

		try {
			const now = Date.now()
			appStore.set(upsertSessionAtom, { session: session(parentID), directory: DIRECTORY })
			appStore.set(upsertSessionAtom, { session: session(stalledID, parentID), directory: DIRECTORY })
			appStore.set(upsertSessionAtom, {
				session: session(unresponsiveID, parentID),
				directory: DIRECTORY,
			})
			appStore.set(setSessionStatusAtom, { sessionId: stalledID, status: { type: "busy" } })
			appStore.set(setSessionStatusAtom, { sessionId: unresponsiveID, status: { type: "busy" } })
			appStore.set(recordSessionActivityAtom, {
				sessionId: stalledID,
				timestamp: now - STALLED_AFTER_MS - 1_000,
			})
			appStore.set(recordSessionActivityAtom, {
				sessionId: unresponsiveID,
				timestamp: now - UNRESPONSIVE_AFTER_MS - 1_000,
			})

			const html = renderToString(
				<Provider store={appStore}>
					<MultiAgentPanel parentSessionId={parentID} />
				</Provider>,
			)

			expect(html).toContain("STALLED")
			expect(html).toContain("UNRESPONSIVE")
			expect(html).toContain("Restart")
			expect(html).toContain("Terminate")
		} finally {
			cleanup(ids)
		}
	})
})
