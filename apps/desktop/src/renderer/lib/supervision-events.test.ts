import { describe, expect, test } from "bun:test"
import type { SupervisionPolicyInput, SupervisionPolicyResult } from "./supervision-policy"
import {
	appendSupervisionEvent,
	createSupervisionEvent,
	shouldPersistSupervisionDecision,
	type SupervisionEvent,
} from "./supervision-events"

function baseInput(overrides: Partial<SupervisionPolicyInput> = {}): SupervisionPolicyInput {
	return {
		workflowId: "workflow-1",
		parentAgentId: "parent-1",
		childAgentCount: 1,
		runningAgentCount: 1,
		failedAgentCount: 0,
		waitingAgentCount: 0,
		totalTokens: 10_000,
		totalCost: 0.05,
		configuredBudget: 0.5,
		maxChildren: 6,
		maxConcurrentAgents: 3,
		currentAgentState: "running",
		...overrides,
	}
}

function policy(
	overrides: Partial<SupervisionPolicyResult> = {},
): SupervisionPolicyResult {
	return {
		workflowId: "workflow-1",
		parentAgentId: "parent-1",
		decision: "warn",
		severity: "warning",
		machineCode: "SUPERVISION_WARN_COST_APPROACHING_BUDGET",
		retryable: true,
		reason: "Cost is approaching budget.",
		operatorMessage: "Workflow spend is approaching the configured budget.",
		recommendedAction: "Use concise prompts.",
		...overrides,
	}
}

describe("supervision events", () => {
	test("creates the structured event shape without prompt content", () => {
		const event = createSupervisionEvent({
			policy: policy(),
			input: {
				...baseInput(),
				// Extra fields should never leak into persisted audit records.
				prompt: "secret prompt content",
			} as SupervisionPolicyInput & { prompt: string },
			now: Date.UTC(2026, 4, 13, 12, 0, 0),
		})

		expect(event).toMatchObject({
			id: "workflow-1:SUPERVISION_WARN_COST_APPROACHING_BUDGET:1778673600000",
			timestamp: "2026-05-13T12:00:00.000Z",
			workflowId: "workflow-1",
			sessionId: "workflow-1",
			parentAgentId: "parent-1",
			decision: "warn",
			severity: "warning",
			machineCode: "SUPERVISION_WARN_COST_APPROACHING_BUDGET",
			totalTokens: 10_000,
			totalCost: 0.05,
			childAgentCount: 1,
			runningAgentCount: 1,
			failedAgentCount: 0,
			waitingAgentCount: 0,
		})
		expect(JSON.stringify(event)).not.toContain("secret prompt content")
	})

	test("does not create or persist allow decisions", () => {
		const allowPolicy = policy({
			decision: "allow",
			severity: "info",
			machineCode: "SUPERVISION_ALLOW",
		})

		expect(shouldPersistSupervisionDecision(allowPolicy)).toBe(false)
		expect(createSupervisionEvent({ policy: allowPolicy, input: baseInput() })).toBeNull()
	})

	test("persists warn decisions", () => {
		const event = createSupervisionEvent({ policy: policy(), input: baseInput(), now: 1 })
		expect(event).not.toBeNull()
		const result = appendSupervisionEvent([], event!)

		expect(result.persisted).toBe(true)
		expect(result.events).toHaveLength(1)
		expect(result.events[0].decision).toBe("warn")
	})

	test("persists throttle, block, and stop decisions", () => {
		const decisions = [
			policy({
				decision: "throttle",
				machineCode: "SUPERVISION_THROTTLE_CONCURRENCY",
			}),
			policy({
				decision: "block",
				severity: "critical",
				machineCode: "SUPERVISION_BLOCK_MAX_CHILDREN",
			}),
			policy({
				decision: "stop",
				severity: "critical",
				machineCode: "SUPERVISION_STOP_BUDGET_EXCEEDED",
			}),
		] as const

		let events: SupervisionEvent[] = []
		for (let i = 0; i < decisions.length; i++) {
			const event = createSupervisionEvent({
				policy: decisions[i],
				input: baseInput({ totalCost: 0.1 + i }),
				now: i,
			})
			const result = appendSupervisionEvent(events, event!)
			events = result.events
			expect(result.persisted).toBe(true)
		}

		expect(events.map((event) => event.decision)).toEqual(["stop", "block", "throttle"])
	})

	test("suppresses duplicate unchanged conditions", () => {
		const first = createSupervisionEvent({ policy: policy(), input: baseInput(), now: 1 })!
		const duplicate = createSupervisionEvent({ policy: policy(), input: baseInput(), now: 2 })!
		const firstResult = appendSupervisionEvent([], first)
		const duplicateResult = appendSupervisionEvent(firstResult.events, duplicate)

		expect(firstResult.persisted).toBe(true)
		expect(duplicateResult.persisted).toBe(false)
		expect(duplicateResult.events).toHaveLength(1)
		expect(duplicateResult.events[0].id).toBe(first.id)
	})
})
