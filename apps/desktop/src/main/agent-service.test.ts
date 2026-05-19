import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AgentService, parseAgentDocument } from "./agent-service"

// ============================================================
// parseAgentDocument — frontmatter parsing
// ============================================================

describe("parseAgentDocument", () => {
	test("parses all frontmatter fields", () => {
		const raw = [
			"---",
			"name: Test Agent",
			"description: Does testing",
			"model: openrouter/deepseek/deepseek-chat-v3.1",
			"mode: subagent",
			"color: warning",
			"team: quality",
			"team-role: member",
			"---",
			"",
			"# System prompt body",
		].join("\n")

		const agent = parseAgentDocument(raw, "test-agent.md")
		expect(agent.filename).toBe("test-agent")
		expect(agent.name).toBe("Test Agent")
		expect(agent.description).toBe("Does testing")
		expect(agent.model).toBe("openrouter/deepseek/deepseek-chat-v3.1")
		expect(agent.mode).toBe("subagent")
		expect(agent.color).toBe("warning")
		expect(agent.team).toBe("quality")
		expect(agent.teamRole).toBe("member")
		expect(agent.prompt).toBe("# System prompt body")
		expect(agent.origin).toBe("user")
	})

	test("falls back to filename when name is missing", () => {
		const raw = "---\ndescription: test\n---\nbody"
		const agent = parseAgentDocument(raw, "my-agent.md")
		expect(agent.name).toBe("my-agent")
		expect(agent.filename).toBe("my-agent")
	})

	test("accepts title as alias for name", () => {
		const raw = "---\ntitle: Title Agent\ndescription: desc\n---\nbody"
		const agent = parseAgentDocument(raw, "titled.md")
		expect(agent.name).toBe("Title Agent")
	})

	test("defaults mode to subagent for unknown values", () => {
		const raw = "---\nmode: unknown-value\n---\nbody"
		const agent = parseAgentDocument(raw, "x.md")
		expect(agent.mode).toBe("subagent")
	})

	test("accepts primary and all modes", () => {
		const primaryRaw = "---\nmode: primary\n---\nbody"
		const allRaw = "---\nmode: all\n---\nbody"
		expect(parseAgentDocument(primaryRaw, "a.md").mode).toBe("primary")
		expect(parseAgentDocument(allRaw, "b.md").mode).toBe("all")
	})

	test("handles missing frontmatter — returns raw as prompt", () => {
		const raw = "# No frontmatter here\n\nJust a bare markdown body."
		const agent = parseAgentDocument(raw, "bare.md")
		expect(agent.filename).toBe("bare")
		expect(agent.name).toBe("bare")
		expect(agent.prompt).toBe(raw)
		expect(agent.description).toBe("")
		expect(agent.model).toBe("")
		expect(agent.mode).toBe("subagent")
	})

	test("strips .md from filename in output", () => {
		const raw = "---\nname: X\n---\nbody"
		expect(parseAgentDocument(raw, "my-agent.md").filename).toBe("my-agent")
		expect(parseAgentDocument(raw, "my-agent").filename).toBe("my-agent")
	})

	test("ignores unknown team-role values", () => {
		const raw = "---\nteam-role: captain\n---\nbody"
		const agent = parseAgentDocument(raw, "a.md")
		expect(agent.teamRole).toBeUndefined()
	})

	test("sets teamRole to leader", () => {
		const raw = "---\nteam-role: leader\n---\nbody"
		expect(parseAgentDocument(raw, "a.md").teamRole).toBe("leader")
	})
})

// ============================================================
// AgentService — list / write / delete / override
// ============================================================

async function makeAgentService() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-agents-"))
	const agentsDir = path.join(dir, ".opencode", "agents")
	const service = new AgentService(agentsDir)
	return {
		dir,
		agentsDir,
		service,
		cleanup: () => fs.rm(dir, { recursive: true, force: true }),
	}
}

function makeAgentRaw(overrides: Record<string, string> = {}, body = "Agent body.") {
	const fields = {
		name: "Test Agent",
		description: "A test agent",
		model: "openrouter/deepseek/deepseek-chat-v3.1",
		mode: "subagent",
		color: "info",
		...overrides,
	}
	return ["---", ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), "---", "", body].join("\n")
}

describe("AgentService.list", () => {
	test("returns empty array when directory does not exist", async () => {
		const { service, cleanup } = await makeAgentService()
		try {
			const agents = await service.list()
			expect(agents).toEqual([])
		} finally {
			await cleanup()
		}
	})

	test("returns all written agents in filename order", async () => {
		const { service, cleanup } = await makeAgentService()
		try {
			await service.write("beta-agent", makeAgentRaw({ name: "Beta" }))
			await service.write("alpha-agent", makeAgentRaw({ name: "Alpha" }))
			const agents = await service.list()
			expect(agents.map((a) => a.filename)).toEqual(["alpha-agent", "beta-agent"])
		} finally {
			await cleanup()
		}
	})

	test("get returns null for missing agent", async () => {
		const { service, cleanup } = await makeAgentService()
		try {
			expect(await service.get("nonexistent")).toBeNull()
		} finally {
			await cleanup()
		}
	})
})

describe("agents:list merge — user overrides builtin by filename", () => {
	test("user agent shadows builtin with the same filename", async () => {
		const { service, cleanup } = await makeAgentService()
		try {
			// Write a user agent with the same filename as a builtin
			await service.write("code-reviewer", makeAgentRaw({ name: "My Code Reviewer" }))

			const userAgents = await service.list()
			const userFilenames = new Set(userAgents.map((a) => a.filename))

			// Simulate builtin agents (as loadBuiltinAgents would return)
			const builtins = [
				{ ...parseAgentDocument(makeAgentRaw({ name: "Builtin Code Reviewer" }), "code-reviewer.md"), origin: "builtin" as const },
				{ ...parseAgentDocument(makeAgentRaw({ name: "Architect" }), "architect.md"), origin: "builtin" as const },
			]

			// Apply the same filter as agents:list
			const filteredBuiltins = builtins.filter((b) => !userFilenames.has(b.filename))
			const merged = [...userAgents, ...filteredBuiltins]

			// "code-reviewer" should come from user, not builtin
			const codeReviewer = merged.find((a) => a.filename === "code-reviewer")
			expect(codeReviewer?.name).toBe("My Code Reviewer")
			expect(codeReviewer?.origin).toBe("user")

			// "architect" passes through from builtins
			const architect = merged.find((a) => a.filename === "architect")
			expect(architect?.origin).toBe("builtin")

			// No duplicates
			const filenames = merged.map((a) => a.filename)
			expect(new Set(filenames).size).toBe(filenames.length)
		} finally {
			await cleanup()
		}
	})

	test("all builtins pass through when no user agents exist", () => {
		const builtins = [
			{ ...parseAgentDocument(makeAgentRaw({ name: "B1" }), "b1.md"), origin: "builtin" as const },
			{ ...parseAgentDocument(makeAgentRaw({ name: "B2" }), "b2.md"), origin: "builtin" as const },
		]
		const userFilenames = new Set<string>()
		const filtered = builtins.filter((b) => !userFilenames.has(b.filename))
		expect(filtered).toHaveLength(2)
	})
})

describe("AgentService.write + delete", () => {
	test("write then get round-trips content", async () => {
		const { service, cleanup } = await makeAgentService()
		try {
			const raw = makeAgentRaw({ name: "Round Trip" })
			await service.write("round-trip", raw)
			const agent = await service.get("round-trip")
			expect(agent?.name).toBe("Round Trip")
			expect(agent?.filename).toBe("round-trip")
		} finally {
			await cleanup()
		}
	})

	test("delete removes the agent", async () => {
		const { service, cleanup } = await makeAgentService()
		try {
			await service.write("temp-agent", makeAgentRaw())
			await service.delete("temp-agent")
			expect(await service.get("temp-agent")).toBeNull()
		} finally {
			await cleanup()
		}
	})

	test("write normalizes filenames", async () => {
		const { service, cleanup } = await makeAgentService()
		try {
			const filename = await service.write("My Agent Name!", makeAgentRaw())
			expect(filename).toBe("my-agent-name")
		} finally {
			await cleanup()
		}
	})
})
