import { describe, expect, test } from "bun:test"
import {
	isCandidateForSkillResolution,
	isClientHandledSlashCommand,
	parseSlashCommand,
} from "./slash-commands"

describe("slash command parsing", () => {
	test("returns null for regular chat text", () => {
		expect(parseSlashCommand("build a feature")).toBeNull()
	})

	test("parses command names and trims arguments", () => {
		expect(parseSlashCommand("/undo")).toEqual({ name: "undo", arguments: "" })
		expect(parseSlashCommand("  /compact now please  ")).toEqual({
			name: "compact",
			arguments: "now please",
		})
	})

	test("parses slash command with multi-word arguments", () => {
		expect(parseSlashCommand("/react-patterns fix the broken button")).toEqual({
			name: "react-patterns",
			arguments: "fix the broken button",
		})
	})

	test("classifies client-handled commands case-insensitively", () => {
		expect(isClientHandledSlashCommand("UNDO")).toBe(true)
		expect(isClientHandledSlashCommand("summarize")).toBe(true)
		expect(isClientHandledSlashCommand("unknown")).toBe(false)
	})
})

describe("isCandidateForSkillResolution", () => {
	test("returns false for reserved built-in command names", () => {
		expect(isCandidateForSkillResolution("undo")).toBe(false)
		expect(isCandidateForSkillResolution("redo")).toBe(false)
		expect(isCandidateForSkillResolution("compact")).toBe(false)
		expect(isCandidateForSkillResolution("summarize")).toBe(false)
		expect(isCandidateForSkillResolution("skills")).toBe(false)
		expect(isCandidateForSkillResolution("fork")).toBe(false)
	})

	test("returns false for reserved commands regardless of case", () => {
		expect(isCandidateForSkillResolution("UNDO")).toBe(false)
		expect(isCandidateForSkillResolution("Compact")).toBe(false)
	})

	test("returns true for unknown command names (potential skills)", () => {
		expect(isCandidateForSkillResolution("react-patterns")).toBe(true)
		expect(isCandidateForSkillResolution("my-custom-skill")).toBe(true)
		expect(isCandidateForSkillResolution("init")).toBe(true)
	})
})
