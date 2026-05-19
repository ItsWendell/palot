/**
 * IPC integration tests.
 *
 * These test the full round-trip through the service layer as if called
 * from IPC handlers, without requiring a running Electron process.
 * They exercise serialization/deserialization boundaries that unit tests
 * on individual services do not cover.
 */

import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ProjectBrainService } from "./project-brain-service"
import { KnowledgeGraphService } from "./knowledge-graph-service"
import { SupervisorStateService } from "./supervisor-state-service"
import type { SubagentOutput } from "./supervisor-state-service"
import { routeTask, routePrompt, resolveAvailableModel } from "./model-routing-service"
import { SemanticIndexService } from "./semantic-index-service"

// ============================================================
// Helpers
// ============================================================

async function makeBrain() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-ipc-int-"))
	const brain = new ProjectBrainService(dir)
	return { dir, brain, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

async function writeFile(root: string, rel: string, content: string) {
	const full = path.join(root, rel)
	await fs.mkdir(path.dirname(full), { recursive: true })
	await fs.writeFile(full, content, "utf-8")
}

// ============================================================
// Brain read/write round-trip
// ============================================================

describe("IPC: brain read/write", () => {
	test("write then read returns the same content", async () => {
		const { brain, cleanup } = await makeBrain()
		try {
			const slug = "test-doc"
			const content = "# Test\n\nSome markdown content with special chars: <>&\""
			await brain.writeFile(slug, content)
			const read = await brain.readFile(slug)
			expect(read).toBe(content)
		} finally {
			await cleanup()
		}
	})

	test("list returns all written slugs", async () => {
		const { brain, cleanup } = await makeBrain()
		try {
			await brain.writeFile("alpha", "content-a")
			await brain.writeFile("beta", "content-b")
			const slugs = await brain.listFiles()
			expect(slugs.sort()).toEqual(["alpha", "beta"])
		} finally {
			await cleanup()
		}
	})

	test("delete removes the file and subsequent read returns null", async () => {
		const { brain, cleanup } = await makeBrain()
		try {
			await brain.writeFile("to-delete", "temporary")
			const deleted = await brain.deleteFile("to-delete")
			expect(deleted).toBe(true)
			const read = await brain.readFile("to-delete")
			expect(read).toBeNull()
		} finally {
			await cleanup()
		}
	})
})

// ============================================================
// Knowledge graph: add → query → remove round-trip
// ============================================================

describe("IPC: knowledge graph round-trip", () => {
	test("add returns entry with generated id and timestamps", async () => {
		const { brain, cleanup } = await makeBrain()
		try {
			const kg = new KnowledgeGraphService(brain)
			const entry = await kg.add({
				type: "decision",
				title: "Use Jotai for state",
				body: "Migrated from Zustand to Jotai for better atom-level granularity.",
				tags: ["state", "jotai"],
				relatedFiles: ["renderer/atoms/session.ts"],
			})

			expect(entry.id).toBeTruthy()
			expect(entry.id.length).toBe(8)
			expect(entry.createdAt).toBeTruthy()
			expect(entry.updatedAt).toBeTruthy()
			expect(entry.type).toBe("decision")
		} finally {
			await cleanup()
		}
	})

	test("query by keyword returns matching entries via BM25", async () => {
		const { brain, cleanup } = await makeBrain()
		try {
			const kg = new KnowledgeGraphService(brain)
			await kg.add({ type: "lesson", title: "SSE reconnect", body: "Use exponential backoff capped at 30s for SSE reconnection", tags: ["sse"], relatedFiles: [] })
			await kg.add({ type: "lesson", title: "IPC logging", body: "Wrap all IPC handlers with withLogging for error visibility", tags: ["ipc"], relatedFiles: [] })

			const results = await kg.query({ keyword: "exponential backoff SSE" })
			expect(results.length).toBeGreaterThanOrEqual(1)
			expect(results[0].title).toBe("SSE reconnect")
		} finally {
			await cleanup()
		}
	})

	test("remove then query excludes removed entry", async () => {
		const { brain, cleanup } = await makeBrain()
		try {
			const kg = new KnowledgeGraphService(brain)
			const entry = await kg.add({ type: "goal", title: "Temp goal", body: "will be removed", tags: [], relatedFiles: [] })
			await kg.remove(entry.id)
			const results = await kg.query({ type: "goal" })
			expect(results).toHaveLength(0)
		} finally {
			await cleanup()
		}
	})
})

// ============================================================
// Supervisor state: save → load → append round-trip
// ============================================================

describe("IPC: supervisor state round-trip", () => {
	test("save then load preserves milestones and tasks", async () => {
		const { brain, cleanup } = await makeBrain()
		try {
			const svc = new SupervisorStateService(brain)
			await svc.save({
				version: 1,
				currentMilestone: "Phase 2: UI",
				completedMilestones: ["Phase 1: Core services"],
				activeTaskIds: ["task-1", "task-2"],
				subagentOutputs: {},
				updatedAt: new Date().toISOString(),
			})

			const loaded = await svc.load()
			expect(loaded.currentMilestone).toBe("Phase 2: UI")
			expect(loaded.completedMilestones).toEqual(["Phase 1: Core services"])
			expect(loaded.activeTaskIds).toEqual(["task-1", "task-2"])
			expect(loaded.subagentOutputs).toEqual({})
		} finally {
			await cleanup()
		}
	})

	test("appendSubagentOutput adds output and preserves existing state", async () => {
		const { brain, cleanup } = await makeBrain()
		try {
			const svc = new SupervisorStateService(brain)
			await svc.save({
				version: 1,
				currentMilestone: "M1",
				completedMilestones: [],
				activeTaskIds: ["task-1"],
				subagentOutputs: {},
				updatedAt: new Date().toISOString(),
			})

			const output: SubagentOutput = {
				sessionId: "sess-abc",
				taskId: "task-1",
				summary: "Found auth handler in src/auth.ts",
				completedAt: new Date().toISOString(),
			}
			const updated = await svc.appendSubagentOutput(output)

			expect(Object.keys(updated.subagentOutputs)).toHaveLength(1)
			expect(updated.subagentOutputs["task-1"].sessionId).toBe("sess-abc")
			expect(updated.activeTaskIds).toEqual([])
			expect(updated.currentMilestone).toBe("M1")
		} finally {
			await cleanup()
		}
	})

	test("setMilestone appends to existing milestones", async () => {
		const { brain, cleanup } = await makeBrain()
		try {
			const svc = new SupervisorStateService(brain)
			await svc.save({
				version: 1,
				currentMilestone: "M1",
				completedMilestones: [],
				activeTaskIds: [],
				subagentOutputs: {},
				updatedAt: new Date().toISOString(),
			})

			await svc.setMilestone("M2: Research complete")
			const loaded = await svc.load()
			expect(loaded.completedMilestones).toContain("M1")
			expect(loaded.currentMilestone).toBe("M2: Research complete")
		} finally {
			await cleanup()
		}
	})
})

// ============================================================
// Model routing: route → resolve round-trip
// ============================================================

describe("IPC: model routing round-trip", () => {
	test("routeTask then resolveAvailableModel produces valid model", () => {
		const preferred = routeTask({
			role: "builder",
			estimatedComplexity: "medium",
			recommendedModel: "",
		})
		// Simulate IPC: preferred goes to renderer, renderer passes it back with available models
		const available = ["anthropic/claude-sonnet-4-6", "anthropic/claude-haiku-4-5"]
		const resolved = resolveAvailableModel(preferred, available)
		expect(available.some((m) => m.includes("sonnet"))).toBe(true)
		expect(resolved).toBe("anthropic/claude-sonnet-4-6")
	})

	test("routePrompt with text classification round-trips through resolve", () => {
		const preferred = routePrompt("explain how the auth middleware works")
		const available = ["anthropic/claude-haiku-4-5-latest"]
		const resolved = resolveAvailableModel(preferred, available)
		// "explain" → low → haiku → fuzzy match
		expect(resolved).toBe("anthropic/claude-haiku-4-5-latest")
	})
})

// ============================================================
// Semantic index: build → search round-trip
// ============================================================

describe("IPC: semantic index round-trip", () => {
	test("build then search produces ranked results", async () => {
		const { dir, brain, cleanup } = await makeBrain()
		try {
			const src = path.join(dir, "project")
			await writeFile(src, "auth-handler.ts", `
export function handleLogin(req: Request) {
	const { username, password } = parseCredentials(req)
	return authenticate(username, password)
}
`)
			await writeFile(src, "payment-handler.ts", `
export function processPayment(orderId: string, amount: number) {
	return chargeCard(orderId, amount)
}
`)
			const svc = new SemanticIndexService(brain)
			const index = await svc.build(src)
			expect(index.entries.length).toBe(2)

			// Search should find the auth handler
			const results = await svc.search("login authentication")
			expect(results.length).toBeGreaterThan(0)
			expect(results[0].filePath).toBe("auth-handler.ts")
		} finally {
			await cleanup()
		}
	})
})
