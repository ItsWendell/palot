import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AgentPerformanceService } from "./agent-performance-service"
import { ProjectBrainService } from "./project-brain-service"

async function makeService() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-agent-perf-"))
	const brain = new ProjectBrainService(dir)
	const service = new AgentPerformanceService(brain)
	return { dir, brain, service, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

describe("AgentPerformanceService", () => {
	test("records one run per session id", async () => {
		const { service, cleanup } = await makeService()
		try {
			await service.record({
				sessionId: "sess-1",
				parentSessionId: "parent",
				agentName: "builder",
				status: "completed",
				completedAt: "2026-05-16T12:00:00.000Z",
				durationMs: 1000,
				costUsd: 0.01,
				tokens: 100,
				toolCallCount: 2,
				errorCount: 0,
				retryCount: 0,
			})
			const ledger = await service.record({
				sessionId: "sess-1",
				parentSessionId: "parent",
				agentName: "builder",
				status: "failed",
				completedAt: "2026-05-16T12:01:00.000Z",
				durationMs: 2000,
				costUsd: 0.02,
				tokens: 200,
				toolCallCount: 3,
				errorCount: 1,
				retryCount: 1,
			})

			expect(ledger.records).toHaveLength(1)
			expect(ledger.records[0].status).toBe("failed")
			expect(ledger.records[0].tokens).toBe(200)
		} finally {
			await cleanup()
		}
	})

	test("preserves corrupted ledger content as a recovery copy", async () => {
		const { brain, service, cleanup } = await makeService()
		try {
			await brain.writeFile("agent-performance", "# broken ledger")
			const ledger = await service.load()
			const slugs = await brain.listFiles()

			expect(ledger.records).toEqual([])
			expect(slugs.some((slug) => slug.startsWith("agent-performance-corrupt-"))).toBe(true)
		} finally {
			await cleanup()
		}
	})
})
