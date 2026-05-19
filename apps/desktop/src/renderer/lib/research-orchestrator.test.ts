import { describe, expect, test } from "bun:test"
import { parseResearchQuestions } from "./research-orchestrator"

// ============================================================
// parseResearchQuestions — the only unit-testable part without
// a live OpenCode server. The orchestrator itself is integration-tested.
// ============================================================

describe("parseResearchQuestions", () => {
	test("returns empty array for empty string", () => {
		expect(parseResearchQuestions("")).toEqual([])
		expect(parseResearchQuestions("   ")).toEqual([])
	})

	test("parses single question", () => {
		expect(parseResearchQuestions("Where is auth handled?")).toEqual([
			"Where is auth handled?",
		])
	})

	test("parses semicolon-separated questions", () => {
		const result = parseResearchQuestions(
			"Where is auth?; How does routing work?; What tests exist?",
		)
		expect(result).toEqual([
			"Where is auth?",
			"How does routing work?",
			"What tests exist?",
		])
	})

	test("parses comma-separated questions when question marks present", () => {
		const result = parseResearchQuestions(
			"Where is auth?, How does routing work?",
		)
		expect(result).toEqual(["Where is auth?", "How does routing work?"])
	})

	test("does not split on commas when no question marks (treats as single question)", () => {
		const result = parseResearchQuestions(
			"find auth, routing, and session handling",
		)
		expect(result).toEqual(["find auth, routing, and session handling"])
	})

	test("parses newline-separated questions", () => {
		const result = parseResearchQuestions(
			"Where is auth?\nHow does routing work?\nWhat tests exist?",
		)
		expect(result).toEqual([
			"Where is auth?",
			"How does routing work?",
			"What tests exist?",
		])
	})

	test("filters out blank lines", () => {
		const result = parseResearchQuestions("Where is auth?\n\n\nHow does routing work?")
		expect(result).toEqual(["Where is auth?", "How does routing work?"])
	})

	test("trims whitespace from each question", () => {
		const result = parseResearchQuestions(
			"  Where is auth?  ;  How does routing work?  ",
		)
		expect(result).toEqual(["Where is auth?", "How does routing work?"])
	})
})
