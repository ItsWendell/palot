import { describe, expect, test } from "bun:test"
import {
	makeResearchPrompt,
	mergeResearchOutputs,
	extractResearchSummary,
} from "./research-agent"

describe("makeResearchPrompt", () => {
	test("includes the question", () => {
		const prompt = makeResearchPrompt({ question: "Where is auth handled?" })
		expect(prompt).toContain("Where is auth handled?")
	})

	test("includes context when provided", () => {
		const prompt = makeResearchPrompt({ question: "Q", context: "We are upgrading auth" })
		expect(prompt).toContain("We are upgrading auth")
	})

	test("includes focus files when provided", () => {
		const prompt = makeResearchPrompt({ question: "Q", files: ["src/auth.ts", "src/session.ts"] })
		expect(prompt).toContain("src/auth.ts")
		expect(prompt).toContain("src/session.ts")
	})

	test("instructs agent not to modify files", () => {
		const prompt = makeResearchPrompt({ question: "Q" })
		expect(prompt).toContain("Do NOT modify any files")
	})

	test("requests RESEARCH_COMPLETE marker", () => {
		const prompt = makeResearchPrompt({ question: "Q" })
		expect(prompt).toContain("RESEARCH_COMPLETE")
	})
})

describe("extractResearchSummary", () => {
	test("extracts summary from RESEARCH_COMPLETE line", () => {
		const output = "Auth is handled in src/auth.ts.\nRESEARCH_COMPLETE: Auth lives in src/auth.ts"
		expect(extractResearchSummary(output)).toBe("Auth lives in src/auth.ts")
	})

	test("returns null when no marker present", () => {
		expect(extractResearchSummary("No marker here.")).toBeNull()
	})
})

describe("mergeResearchOutputs", () => {
	test("returns empty string for no results", () => {
		expect(mergeResearchOutputs([])).toBe("")
	})

	test("returns raw answer for single result", () => {
		const r = { sessionId: "s1", question: "Q", answer: "A", completedAt: "" }
		expect(mergeResearchOutputs([r])).toBe("A")
	})

	test("combines multiple results with headers", () => {
		const results = [
			{ sessionId: "s1", question: "Where is auth?", answer: "Auth is in src/auth.ts\nRESEARCH_COMPLETE: auth.ts", completedAt: "" },
			{ sessionId: "s2", question: "Where is routing?", answer: "Routes in src/router.ts\nRESEARCH_COMPLETE: router.ts", completedAt: "" },
		]
		const merged = mergeResearchOutputs(results)
		expect(merged).toContain("Research Summary (2 agents)")
		expect(merged).toContain("Where is auth?")
		expect(merged).toContain("Where is routing?")
	})
})
