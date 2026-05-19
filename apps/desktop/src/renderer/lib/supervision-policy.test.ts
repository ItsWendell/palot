import { describe, expect, test } from "bun:test"
import { evaluateSupervisionPolicy, type SupervisionPolicyInput } from "./supervision-policy"

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
		configuredBudget: 1,
		maxChildren: 12,
		maxConcurrentAgents: 3,
		currentAgentState: "running",
		...overrides,
	}
}

describe("supervision policy", () => {
	test("allows under normal limits", () => {
		const result = evaluateSupervisionPolicy(baseInput())
		expect(result.decision).toBe("allow")
		expect(result.machineCode).toBe("SUPERVISION_ALLOW")
	})

	test("warns when cost approaches budget", () => {
		const result = evaluateSupervisionPolicy(baseInput({ totalCost: 0.75 }))
		expect(result.decision).toBe("warn")
		expect(result.machineCode).toBe("SUPERVISION_WARN_COST_APPROACHING_BUDGET")
	})

	test("blocks when max child-agent count is reached", () => {
		const result = evaluateSupervisionPolicy(baseInput({ childAgentCount: 12 }))
		expect(result.decision).toBe("block")
		expect(result.machineCode).toBe("SUPERVISION_BLOCK_MAX_CHILDREN")
		expect(result.retryable).toBe(false)
	})

	test("throttles when max concurrent running agents is reached", () => {
		const result = evaluateSupervisionPolicy(baseInput({ runningAgentCount: 3 }))
		expect(result.decision).toBe("throttle")
		expect(result.machineCode).toBe("SUPERVISION_THROTTLE_CONCURRENCY")
		expect(result.retryable).toBe(true)
	})

	test("stops active work when budget is exceeded", () => {
		const result = evaluateSupervisionPolicy(baseInput({ totalCost: 1 }))
		expect(result.decision).toBe("stop")
		expect(result.machineCode).toBe("SUPERVISION_STOP_BUDGET_EXCEEDED")
	})

	test("blocks idle work when budget is exceeded", () => {
		const result = evaluateSupervisionPolicy(
			baseInput({ totalCost: 1, currentAgentState: "completed", runningAgentCount: 0 }),
		)
		expect(result.decision).toBe("block")
		expect(result.machineCode).toBe("SUPERVISION_BLOCK_BUDGET_EXCEEDED")
	})

	test("warns when child failures occur", () => {
		const result = evaluateSupervisionPolicy(baseInput({ failedAgentCount: 1, runningAgentCount: 0 }))
		expect(result.decision).toBe("warn")
		expect(result.machineCode).toBe("SUPERVISION_WARN_CHILD_FAILURES")
	})

	test("uses deterministic priority order when multiple risks exist", () => {
		expect(
			evaluateSupervisionPolicy(
				baseInput({
					totalCost: 1,
					childAgentCount: 12,
					runningAgentCount: 3,
					failedAgentCount: 1,
				}),
			).machineCode,
		).toBe("SUPERVISION_STOP_BUDGET_EXCEEDED")

		expect(
			evaluateSupervisionPolicy(
				baseInput({
					childAgentCount: 12,
					runningAgentCount: 3,
					failedAgentCount: 1,
				}),
			).machineCode,
		).toBe("SUPERVISION_BLOCK_MAX_CHILDREN")

		expect(
			evaluateSupervisionPolicy(
				baseInput({
					runningAgentCount: 3,
					failedAgentCount: 1,
				}),
			).machineCode,
		).toBe("SUPERVISION_THROTTLE_CONCURRENCY")
	})
})
