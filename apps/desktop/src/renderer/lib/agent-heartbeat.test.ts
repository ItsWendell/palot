import { describe, expect, test } from "bun:test"
import {
	evaluateAgentHeartbeat,
	STALLED_AFTER_MS,
	UNRESPONSIVE_AFTER_MS,
} from "./agent-heartbeat"

describe("agent heartbeat", () => {
	test("marks running agents active before the stalled threshold", () => {
		const result = evaluateAgentHeartbeat({
			agentStatus: "running",
			lastActivityAt: 1_000,
			now: 1_000 + STALLED_AFTER_MS - 1,
		})
		expect(result.status).toBe("ACTIVE")
		expect(result.canRestart).toBe(false)
		expect(result.canTerminate).toBe(false)
	})

	test("marks running agents stalled after two minutes without activity", () => {
		const result = evaluateAgentHeartbeat({
			agentStatus: "running",
			lastActivityAt: 1_000,
			now: 1_000 + STALLED_AFTER_MS,
		})
		expect(result.status).toBe("STALLED")
		expect(result.canRestart).toBe(true)
		expect(result.canTerminate).toBe(true)
	})

	test("marks running agents unresponsive after five minutes without activity", () => {
		const result = evaluateAgentHeartbeat({
			agentStatus: "running",
			lastActivityAt: 1_000,
			now: 1_000 + UNRESPONSIVE_AFTER_MS,
		})
		expect(result.status).toBe("UNRESPONSIVE")
		expect(result.canRestart).toBe(true)
		expect(result.canTerminate).toBe(true)
	})

	test("does not mark idle or waiting agents as stalled", () => {
		expect(
			evaluateAgentHeartbeat({
				agentStatus: "idle",
				lastActivityAt: 1_000,
				now: 1_000 + UNRESPONSIVE_AFTER_MS,
			}).status,
		).toBe("INACTIVE")
		expect(
			evaluateAgentHeartbeat({
				agentStatus: "waiting",
				lastActivityAt: 1_000,
				now: 1_000 + UNRESPONSIVE_AFTER_MS,
			}).status,
		).toBe("INACTIVE")
	})
})
