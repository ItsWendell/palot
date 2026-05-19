import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ProjectBrainService } from "./project-brain-service"
import { SupervisorStateService } from "./supervisor-state-service"

async function makeTmpService() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-supervisor-"))
	const brain = new ProjectBrainService(dir)
	const svc = new SupervisorStateService(brain)
	return { dir, svc, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

describe("SupervisorStateService", () => {
	test("load returns empty state when no file exists", async () => {
		const { svc, cleanup } = await makeTmpService()
		try {
			const state = await svc.load()
			expect(state.version).toBe(1)
			expect(state.currentMilestone).toBeNull()
			expect(state.completedMilestones).toHaveLength(0)
			expect(state.activeTaskIds).toHaveLength(0)
		} finally {
			await cleanup()
		}
	})

	test("save and load round-trip preserves milestones and active tasks", async () => {
		const { svc, cleanup } = await makeTmpService()
		try {
			const state = await svc.load()
			state.currentMilestone = "Phase 1: API layer"
			state.activeTaskIds = ["task-a", "task-b"]
			await svc.save(state)

			const loaded = await svc.load()
			expect(loaded.currentMilestone).toBe("Phase 1: API layer")
			expect(loaded.activeTaskIds).toContain("task-a")
			expect(loaded.activeTaskIds).toContain("task-b")
		} finally {
			await cleanup()
		}
	})

	test("setMilestone moves current to completed and sets new", async () => {
		const { svc, cleanup } = await makeTmpService()
		try {
			await svc.setMilestone("Phase 1")
			await svc.setMilestone("Phase 2")
			const state = await svc.load()
			expect(state.currentMilestone).toBe("Phase 2")
			expect(state.completedMilestones).toContain("Phase 1")
		} finally {
			await cleanup()
		}
	})

	test("setMilestone does not duplicate if same milestone set twice", async () => {
		const { svc, cleanup } = await makeTmpService()
		try {
			await svc.setMilestone("Phase 1")
			await svc.setMilestone("Phase 1")
			const state = await svc.load()
			expect(state.completedMilestones).toHaveLength(0)
			expect(state.currentMilestone).toBe("Phase 1")
		} finally {
			await cleanup()
		}
	})

	test("appendSubagentOutput records output and removes task from active list", async () => {
		const { svc, cleanup } = await makeTmpService()
		try {
			await svc.markTaskActive("task-x")
			const updated = await svc.appendSubagentOutput({
				sessionId: "sess-1",
				taskId: "task-x",
				summary: "Implemented the API endpoint.",
				completedAt: new Date().toISOString(),
			})
			expect(updated.activeTaskIds).not.toContain("task-x")
			expect(updated.subagentOutputs["task-x"].summary).toContain("API endpoint")
		} finally {
			await cleanup()
		}
	})

	test("markTaskActive adds to active list without duplicates", async () => {
		const { svc, cleanup } = await makeTmpService()
		try {
			await svc.markTaskActive("task-1")
			await svc.markTaskActive("task-1")
			const state = await svc.load()
			expect(state.activeTaskIds.filter((id) => id === "task-1")).toHaveLength(1)
		} finally {
			await cleanup()
		}
	})
})
