import { describe, expect, test } from "bun:test"
import { evaluateAgentWorkflowPolicy, type AgentWorkflowPolicyInput } from "./agent-workflow-policy"

function input(overrides: Partial<AgentWorkflowPolicyInput> = {}): AgentWorkflowPolicyInput {
	return {
		workflowKind: "research",
		runningAgentCount: 0,
		maxConcurrentAgents: 3,
		hasFileLocking: false,
		hasIsolatedFileOwnership: false,
		...overrides,
	}
}

describe("agent workflow policy", () => {
	test("allows parallel research and planning under concurrency limits", () => {
		expect(evaluateAgentWorkflowPolicy(input({ workflowKind: "research" })).mode).toBe("parallel")
		expect(evaluateAgentWorkflowPolicy(input({ workflowKind: "planning" })).mode).toBe("parallel")
	})

	test("falls back to sequential shared writes when locking is unavailable", () => {
		const result = evaluateAgentWorkflowPolicy(input({ workflowKind: "shared_write" }))
		expect(result.allowed).toBe(true)
		expect(result.mode).toBe("sequential")
	})

	test("allows isolated writes only when ownership is explicit", () => {
		expect(evaluateAgentWorkflowPolicy(input({ workflowKind: "isolated_write" })).mode).toBe(
			"sequential",
		)
		expect(
			evaluateAgentWorkflowPolicy(
				input({ workflowKind: "isolated_write", hasIsolatedFileOwnership: true }),
			).mode,
		).toBe("parallel")
	})

	test("blocks new work when max concurrency is reached", () => {
		const result = evaluateAgentWorkflowPolicy(input({ runningAgentCount: 3 }))
		expect(result.allowed).toBe(false)
		expect(result.mode).toBe("sequential")
	})
})
