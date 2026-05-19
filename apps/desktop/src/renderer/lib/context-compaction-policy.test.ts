import { describe, expect, test } from "bun:test"
import { evaluateContextCompactionPolicy } from "./context-compaction-policy"

function usage(percentage: number, compactionPercentage = percentage) {
	return { percentage, compactionPercentage }
}

describe("context compaction policy", () => {
	test("uses the requested threshold states", () => {
		expect(evaluateContextCompactionPolicy({ usage: usage(59) }).state).toBe("NORMAL")
		expect(evaluateContextCompactionPolicy({ usage: usage(60) }).state).toBe("HIGH_CONTEXT")
		expect(evaluateContextCompactionPolicy({ usage: usage(75) }).state).toBe(
			"COMPACTION_SUGGESTED",
		)
		expect(evaluateContextCompactionPolicy({ usage: usage(85) }).state).toBe("AUTO_COMPACTING")
		expect(evaluateContextCompactionPolicy({ usage: usage(95) }).state).toBe(
			"BLOCKED_UNTIL_COMPACTED",
		)
	})

	test("uses compaction percentage when it is higher than context-window percentage", () => {
		const result = evaluateContextCompactionPolicy({ usage: usage(50, 86) })
		expect(result.state).toBe("AUTO_COMPACTING")
		expect(result.shouldAutoCompact).toBe(true)
	})

	test("blocks critical context and disables auto compaction when configured off", () => {
		const result = evaluateContextCompactionPolicy({
			usage: usage(96),
			autoCompactionEnabled: false,
		})
		expect(result.state).toBe("BLOCKED_UNTIL_COMPACTED")
		expect(result.shouldBlockNewWork).toBe(true)
		expect(result.shouldAutoCompact).toBe(false)
	})

	test("reports transient compacting and compacted states", () => {
		expect(
			evaluateContextCompactionPolicy({
				usage: usage(20),
				isCompacting: true,
			}).state,
		).toBe("AUTO_COMPACTING")
		expect(
			evaluateContextCompactionPolicy({
				usage: usage(20),
				wasCompacted: true,
			}).state,
		).toBe("COMPACTED")
	})
})
