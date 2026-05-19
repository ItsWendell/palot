import { describe, expect, test } from "bun:test"
import { classifyAutomationError, createLifecycleEvent, getRetryDecision } from "./reliability"

describe("automation reliability helpers", () => {
	test("classifies timeout and provider failures as retryable", () => {
		const timeout = classifyAutomationError(new Error("session timed out after 600s"), {
			automationId: "nightly",
			operation: "monitor",
		})
		expect(timeout.category).toBe("TimeoutError")
		expect(timeout.retryable).toBe(true)
		expect(timeout.context.automationId).toBe("nightly")

		const provider = classifyAutomationError(new Error("fetch failed with 503 provider outage"))
		expect(provider.category).toBe("ProviderError")
		expect(provider.retryable).toBe(true)
	})

	test("classifies configuration and validation failures as non-retryable", () => {
		const spawn = classifyAutomationError(new Error("No OpenCode server running"))
		expect(spawn.category).toBe("SpawnError")
		expect(spawn.retryable).toBe(false)

		const malformed = classifyAutomationError(new Error("Failed to create session: no session ID returned"))
		expect(malformed.category).toBe("ValidationError")
		expect(malformed.retryable).toBe(false)
	})

	test("uses retryability, caps, exponential backoff, and jitter for retry decisions", () => {
		const retryable = classifyAutomationError(new Error("rate limit 429"))
		const first = getRetryDecision({
			error: retryable,
			attempt: 1,
			maxAttempts: 3,
			baseDelaySec: 10,
			jitter: () => 0.5,
		})
		expect(first.shouldRetry).toBe(true)
		expect(first.delayMs).toBe(11_000)
		expect(first.nextAttempt).toBe(2)

		const second = getRetryDecision({
			error: retryable,
			attempt: 2,
			maxAttempts: 3,
			baseDelaySec: 10,
			jitter: () => 0,
		})
		expect(second.delayMs).toBe(20_000)

		const capped = getRetryDecision({
			error: retryable,
			attempt: 3,
			maxAttempts: 3,
			baseDelaySec: 10,
		})
		expect(capped.shouldRetry).toBe(false)

		const fatal = getRetryDecision({
			error: classifyAutomationError(new Error("api key unauthorized")),
			attempt: 1,
			maxAttempts: 3,
			baseDelaySec: 10,
		})
		expect(fatal.shouldRetry).toBe(false)
	})

	test("creates lifecycle events with required correlation metadata", () => {
		const event = createLifecycleEvent({
			workflowId: "automation-1",
			agentId: "session-1",
			parentAgentId: null,
			taskId: "run-1",
			eventType: "agent.started",
			state: "running",
			attempt: 1,
			tokenUsage: 123,
			estimatedCost: 0.02,
		})

		expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
		expect(event.workflowId).toBe("automation-1")
		expect(event.agentId).toBe("session-1")
		expect(event.taskId).toBe("run-1")
		expect(event.state).toBe("running")
	})
})
