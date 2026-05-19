import { describe, expect, test } from "bun:test"
import { buildHiveSpawnPrompt } from "./hive-spawn-prompt"
import type { ManagedSkill } from "../../shared/skills"

const reactSkill: ManagedSkill = {
	filename: "react-best-practices",
	name: "react-best-practices",
	description: "React performance optimization guidelines",
	tags: ["react", "frontend", "performance"],
	author: "",
	created: "",
	content: "",
	raw: "",
	origin: "project",
}

describe("buildHiveSpawnPrompt", () => {
	test("always includes brain, tools, hive reporting, and task sections", () => {
		const prompt = buildHiveSpawnPrompt({
			agentName: "frontend-developer",
			agentDescription: "Builds UI",
			customInstruction: "Fix the Brain page render state.",
			brainContext: "## issues\nKnown issue",
			memories: "## Relevant Memories\nPrior run",
			skills: [reactSkill],
		})

		expect(prompt).toContain("Nexus Builder Hive Operating Protocol")
		expect(prompt).toContain("brain_search")
		expect(prompt).toContain("brain_append")
		expect(prompt).toContain("brain_record_event")
		expect(prompt).toContain("brain_write")
		expect(prompt).toContain("Use tools directly")
		expect(prompt).toContain("End with a concise report")
		expect(prompt).toContain("## Current Brain Context")
		expect(prompt).toContain("## Relevant Memories")
		expect(prompt).toContain("react-best-practices")
		expect(prompt).toContain("## Task")
		expect(prompt).toContain("Fix the Brain page render state.")
	})

	test("includes mandatory HANDOFF_READY brain-write instruction", () => {
		const prompt = buildHiveSpawnPrompt({
			agentName: "react-specialist",
			agentDescription: "React expert",
			customInstruction: "Fix the scroll bug.",
		})

		expect(prompt).toContain("HANDOFF_READY")
		expect(prompt).toContain("brain_append run-history")
		expect(prompt).toContain("Status: complete | blocked | failed")
		expect(prompt).toContain("Summary:")
		expect(prompt).toContain("Files:")
		expect(prompt).toContain("Blockers:")
	})

	test("falls back to a useful task when no custom instruction is provided", () => {
		const prompt = buildHiveSpawnPrompt({
			agentName: "qa-expert",
			agentDescription: "",
			customInstruction: "",
		})

		expect(prompt).toContain("Begin your work as qa-expert.")
		expect(prompt).toContain("If a project skill applies")
	})

	test("truncates memories beyond 3 000 chars", () => {
		const bigMemories = "x".repeat(5_000)
		const prompt = buildHiveSpawnPrompt({
			agentName: "researcher",
			agentDescription: "",
			customInstruction: "Do research.",
			memories: bigMemories,
		})
		expect(prompt).toContain("truncated to 3000 chars")
		expect(prompt.includes(bigMemories)).toBe(false)
	})

	test("truncates a knowledge section beyond 12 000 chars", () => {
		const bigDoc = "A".repeat(20_000)
		const prompt = buildHiveSpawnPrompt({
			agentName: "engineer",
			agentDescription: "",
			customInstruction: "Build it.",
			knowledgeSections: [{ title: "API Reference", prompt: bigDoc }],
		})
		expect(prompt).toContain("Knowledge section truncated")
		expect(prompt.includes(bigDoc)).toBe(false)
	})

	test("omits later knowledge sections when total budget exhausted", () => {
		const section = "B".repeat(13_000)
		const prompt = buildHiveSpawnPrompt({
			agentName: "engineer",
			agentDescription: "",
			customInstruction: "Build it.",
			knowledgeSections: [
				{ title: "First", prompt: section },
				{ title: "Second", prompt: section },
				{ title: "Third", prompt: section },
			],
		})
		expect(prompt).toContain("knowledge budget exhausted")
	})

	test("surfaces non-blocking context warnings", () => {
		const prompt = buildHiveSpawnPrompt({
			agentName: "debugger",
			agentDescription: "",
			customInstruction: "Investigate the failure.",
			warnings: ["Brain context unavailable: timeout"],
		})

		expect(prompt).toContain("## Context Warnings")
		expect(prompt).toContain("- Brain context unavailable: timeout")
		expect(prompt).toContain("report these warnings back to the Boss")
	})

	test("prepends agentSystemPrompt before Hive protocol when provided", () => {
		const systemPrompt = "You are a React specialist. You focus exclusively on React components."
		const prompt = buildHiveSpawnPrompt({
			agentName: "react-specialist",
			agentDescription: "React component expert",
			agentSystemPrompt: systemPrompt,
			customInstruction: "Fix the scroll bug.",
		})

		const systemPromptIdx = prompt.indexOf(systemPrompt)
		const hiveIdx = prompt.indexOf("## Nexus Builder Hive Operating Protocol")

		expect(systemPromptIdx).toBeGreaterThanOrEqual(0)
		expect(hiveIdx).toBeGreaterThan(systemPromptIdx)
		// Identity fallback line should NOT appear when system prompt is set
		expect(prompt).not.toContain("spawned by the Lead Agent (Boss) inside Nexus Builder's Hive Mind.")
	})

	test("falls back to identity header when agentSystemPrompt is empty string", () => {
		const prompt = buildHiveSpawnPrompt({
			agentName: "builder",
			agentDescription: "General builder",
			agentSystemPrompt: "",
			customInstruction: "Build the feature.",
		})

		expect(prompt).toContain("spawned by the Lead Agent (Boss) inside Nexus Builder's Hive Mind.")
		expect(prompt).toContain("## Nexus Builder Hive Operating Protocol")
	})

	test("falls back to identity header when agentSystemPrompt is omitted", () => {
		const prompt = buildHiveSpawnPrompt({
			agentName: "architect",
			agentDescription: "System designer",
			customInstruction: "Design the API.",
		})

		expect(prompt).toContain("You are **architect**")
		expect(prompt).toContain("spawned by the Lead Agent (Boss) inside Nexus Builder's Hive Mind.")
	})
})
