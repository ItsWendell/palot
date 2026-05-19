import { describe, expect, test } from "bun:test"
import {
	getAgentDisplayName,
	getAgentStatusBadgeClass,
	getAgentStatusLabel,
	getBudgetDisplay,
	getSupervisorDecision,
} from "./agent-progress-display"

describe("agent progress display helpers", () => {
	test("maps spend to budget modes at the requested thresholds", () => {
		expect(getBudgetDisplay(0.24).label).toBe("NORMAL")
		expect(getBudgetDisplay(0.25).label).toBe("FRUGAL")
		expect(getBudgetDisplay(0.5).label).toBe("FRUGAL")
		expect(getBudgetDisplay(0.51).label).toBe("EMERGENCY")
	})

	test("normalizes common hive agent names", () => {
		expect(getAgentDisplayName("spawn architect worker")).toBe("Architect")
		expect(getAgentDisplayName("builder")).toBe("Builder")
		expect(getAgentDisplayName("reviewer pass")).toBe("Reviewer")
		expect(getAgentDisplayName("lead-agent")).toBe("Lead-Agent")
		expect(getAgentDisplayName("qa_agent")).toBe("Qa Agent")
	})

	test("maps statuses to compact labels and semantic classes", () => {
		expect(getAgentStatusLabel("running")).toBe("RUNNING")
		expect(getAgentStatusLabel("completed")).toBe("DONE")
		expect(getAgentStatusBadgeClass("failed")).toContain("red")
		expect(getAgentStatusBadgeClass("waiting")).toContain("amber")
	})

	test("prioritizes supervisor decisions by operational risk", () => {
		expect(
			getSupervisorDecision({
				totalCost: 0.51,
				totalTokens: 10,
				childCount: 1,
				runningCount: 1,
				failedCount: 1,
				waitingCount: 0,
			}).label,
		).toBe("Budget exceeded")

		expect(
			getSupervisorDecision({
				totalCost: 0.1,
				totalTokens: 10,
				childCount: 1,
				runningCount: 0,
				failedCount: 1,
				waitingCount: 0,
			}).label,
		).toBe("Agent failure")

		expect(
			getSupervisorDecision({
				totalCost: 0.1,
				totalTokens: 10,
				childCount: 7,
				runningCount: 7,
				failedCount: 0,
				waitingCount: 0,
			}).label,
		).toBe("High fan-out")
	})

	test("reports healthy, waiting, and idle supervisor states", () => {
		expect(
			getSupervisorDecision({
				totalCost: 0.1,
				totalTokens: 10,
				childCount: 2,
				runningCount: 0,
				failedCount: 0,
				waitingCount: 1,
			}).label,
		).toBe("Waiting")

		expect(
			getSupervisorDecision({
				totalCost: 0.1,
				totalTokens: 10,
				childCount: 2,
				runningCount: 1,
				failedCount: 0,
				waitingCount: 0,
			}).label,
		).toBe("Healthy")

		expect(
			getSupervisorDecision({
				totalCost: 0,
				totalTokens: 0,
				childCount: 0,
				runningCount: 0,
				failedCount: 0,
				waitingCount: 0,
			}).label,
		).toBe("Idle")
	})
})
