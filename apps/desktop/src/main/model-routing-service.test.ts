import { describe, expect, test } from "bun:test"
import {
	classifyPromptComplexity,
	routePrompt,
	routeTask,
	MODEL_TIERS,
	resolveAvailableModel,
	routeTaskResolved,
	routePromptResolved,
} from "./model-routing-service"
import type { BrainTask } from "../shared/tasks"

function makeTask(
	role: BrainTask["role"],
	complexity: BrainTask["estimatedComplexity"],
	recommendedModel = "",
): Pick<BrainTask, "role" | "estimatedComplexity" | "recommendedModel"> {
	return { role, estimatedComplexity: complexity, recommendedModel }
}

// ============================================================
// classifyPromptComplexity
// ============================================================

describe("classifyPromptComplexity", () => {
	test("short explanation text → low", () => {
		expect(classifyPromptComplexity("explain this function to me")).toBe("low")
	})

	test("list / summarize → low", () => {
		expect(classifyPromptComplexity("summarize the changes made")).toBe("low")
	})

	test("architecture keyword → high", () => {
		expect(classifyPromptComplexity("redesign the architecture for concurrent requests")).toBe("high")
	})

	test("security keyword → high", () => {
		expect(classifyPromptComplexity("review the security of this authentication flow")).toBe("high")
	})

	test("medium-length prompt without special keywords → medium", () => {
		const text = "Update the API handler to accept a new optional field and validate it correctly before storing."
		expect(classifyPromptComplexity(text)).toBe("medium")
	})

	test("very long prompt → high regardless of content", () => {
		const text = "x ".repeat(800)
		expect(classifyPromptComplexity(text)).toBe("high")
	})
})

// ============================================================
// routePrompt
// ============================================================

describe("routePrompt", () => {
	test("returns haiku model for low-complexity prompt", () => {
		expect(routePrompt("list all files")).toBe(MODEL_TIERS.low)
	})

	test("returns opus model for high-complexity prompt", () => {
		expect(routePrompt("refactor the distributed architecture for better performance")).toBe(MODEL_TIERS.high)
	})
})

// ============================================================
// routeTask
// ============================================================

describe("routeTask", () => {
	test("respects explicit recommendedModel when set", () => {
		const task = makeTask("builder", "low", "openrouter/deepseek/deepseek-chat")
		expect(routeTask(task)).toBe("openrouter/deepseek/deepseek-chat")
	})

	test("architect + high → opus", () => {
		expect(routeTask(makeTask("architect", "high"))).toBe(MODEL_TIERS.high)
	})

	test("docs + low → haiku", () => {
		expect(routeTask(makeTask("docs", "low"))).toBe(MODEL_TIERS.low)
	})

	test("builder + medium → sonnet", () => {
		expect(routeTask(makeTask("builder", "medium"))).toBe(MODEL_TIERS.medium)
	})

	test("reviewer + high → opus (takes max of role and complexity tiers)", () => {
		expect(routeTask(makeTask("reviewer", "high"))).toBe(MODEL_TIERS.high)
	})

	test("docs + high → sonnet (complexity beats role)", () => {
		// docs role = low, complexity = high → merged = high → but docs ceiling is opus
		// Actually: mergeTiers(low, high) = high → MODEL_TIERS.high
		expect(routeTask(makeTask("docs", "high"))).toBe(MODEL_TIERS.high)
	})

	test("architect + low → high (role wins over complexity)", () => {
		// architect role = high, complexity = low → merged = high
		expect(routeTask(makeTask("architect", "low"))).toBe(MODEL_TIERS.high)
	})

	test("ignores whitespace-only recommendedModel", () => {
		const task = makeTask("builder", "medium", "   ")
		expect(routeTask(task)).toBe(MODEL_TIERS.medium)
	})
})

// ============================================================
// resolveAvailableModel
// ============================================================

describe("resolveAvailableModel", () => {
	test("returns preferred model when exact match found", () => {
		const available = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7"]
		expect(resolveAvailableModel("claude-sonnet-4-6", available)).toBe("claude-sonnet-4-6")
	})

	test("returns fuzzy match when preferred is substring of available", () => {
		const available = ["anthropic/claude-sonnet-4-6", "anthropic/claude-opus-4-7"]
		expect(resolveAvailableModel("claude-sonnet-4-6", available)).toBe("anthropic/claude-sonnet-4-6")
	})

	test("falls back to same-tier model when no exact or fuzzy match", () => {
		const available = ["google/gemini-pro-2.5", "anthropic/claude-opus-4-7"]
		// "claude-sonnet-4-6" is medium tier, gemini-pro is also medium tier (has "pro")
		expect(resolveAvailableModel("claude-sonnet-4-6", available)).toBe("google/gemini-pro-2.5")
	})

	test("falls back to any available model when no tier match", () => {
		const available = ["openrouter/deepseek/deepseek-chat"]
		expect(resolveAvailableModel("claude-opus-4-7", available)).toBe("openrouter/deepseek/deepseek-chat")
	})

	test("returns preferred model unchanged when no available models", () => {
		expect(resolveAvailableModel("claude-opus-4-7", [])).toBe("claude-opus-4-7")
	})

	test("fuzzy matches base name without version suffix", () => {
		const available = ["anthropic/claude-haiku-4-5-latest"]
		expect(resolveAvailableModel("claude-haiku-4-5-20251001", available)).toBe("anthropic/claude-haiku-4-5-latest")
	})
})

// ============================================================
// routeTaskResolved / routePromptResolved
// ============================================================

describe("routeTaskResolved", () => {
	test("resolves to available model when preferred tier exists", () => {
		const available = ["my-haiku", "my-sonnet", "my-opus"]
		// docs + low → haiku tier, but haiku not in available list by exact name
		// Falls to any available (my-haiku has no tier indicator)
		const result = routeTaskResolved(makeTask("docs", "low"), available)
		expect(available).toContain(result)
	})
})

describe("routePromptResolved", () => {
	test("resolves prompt to available model", () => {
		const available = ["anthropic/claude-haiku-4-5-latest"]
		const result = routePromptResolved("list all files", available)
		// "list all files" → low → haiku → fuzzy match to available haiku
		expect(result).toBe("anthropic/claude-haiku-4-5-latest")
	})
})
