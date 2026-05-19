import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ProjectBrainService } from "./project-brain-service"
import { TaskGraphService } from "./task-graph-service"
import type { BrainTask } from "../shared/tasks"

function makeTask(taskId: string, filesOwned: string[]): BrainTask {
	return {
		taskId,
		title: `Task ${taskId}`,
		description: "",
		role: "builder",
		status: "pending",
		dependencies: [],
		filesOwned,
		estimatedComplexity: "low",
		recommendedModel: "openrouter/deepseek/deepseek-chat-v3.1",
		contextRequired: [],
		outputRequired: [],
		validationCommands: [],
	}
}

describe("TaskGraphService", () => {
	test("detectConflicts finds overlapping filesOwned across two tasks", () => {
		const dir = os.tmpdir()
		const service = new TaskGraphService(new ProjectBrainService(dir))
		const tasks = [
			makeTask("task-a", ["src/foo.ts", "src/bar.ts"]),
			makeTask("task-b", ["src/bar.ts", "src/baz.ts"]),
		]
		const conflicts = service.detectConflicts(tasks)
		expect(conflicts).toHaveLength(1)
		expect(conflicts[0].file).toBe("src/bar.ts")
		expect(conflicts[0].conflictingTasks).toContain("task-a")
		expect(conflicts[0].conflictingTasks).toContain("task-b")
	})

	test("detectConflicts returns empty for disjoint files", () => {
		const dir = os.tmpdir()
		const service = new TaskGraphService(new ProjectBrainService(dir))
		const tasks = [
			makeTask("task-a", ["src/foo.ts"]),
			makeTask("task-b", ["src/bar.ts"]),
		]
		const conflicts = service.detectConflicts(tasks)
		expect(conflicts).toHaveLength(0)
	})

	test("buildExecutionPlan returns blocked when conflicts exist", () => {
		const dir = os.tmpdir()
		const service = new TaskGraphService(new ProjectBrainService(dir))
		const tasks = [
			makeTask("task-a", ["shared.ts"]),
			makeTask("task-b", ["shared.ts"]),
		]
		const plan = service.buildExecutionPlan(tasks)
		expect(plan.recommendation).toBe("blocked")
		expect(plan.safe).toBe(false)
		expect(plan.conflicts.length).toBeGreaterThan(0)
	})

	test("buildExecutionPlan returns parallel for disjoint files", () => {
		const dir = os.tmpdir()
		const service = new TaskGraphService(new ProjectBrainService(dir))
		const tasks = [
			makeTask("task-a", ["src/a.ts"]),
			makeTask("task-b", ["src/b.ts"]),
		]
		const plan = service.buildExecutionPlan(tasks)
		expect(plan.recommendation).toBe("parallel")
		expect(plan.safe).toBe(true)
		expect(plan.conflicts).toHaveLength(0)
	})

	test("upsertTask adds a new task", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-tasks-"))
		const service = new TaskGraphService(new ProjectBrainService(dir))
		try {
			const task = makeTask("new-task", ["src/new.ts"])
			const graph = await service.upsertTask(task)
			expect(graph.tasks).toHaveLength(1)
			expect(graph.tasks[0].taskId).toBe("new-task")
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("upsertTask updates an existing task", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-tasks-"))
		const service = new TaskGraphService(new ProjectBrainService(dir))
		try {
			const task = makeTask("existing-task", ["src/foo.ts"])
			await service.upsertTask(task)
			const updated = { ...task, title: "Updated Title" }
			const graph = await service.upsertTask(updated)
			expect(graph.tasks).toHaveLength(1)
			expect(graph.tasks[0].title).toBe("Updated Title")
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("executionOrder round-trips through save/load", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-tasks-"))
		const service = new TaskGraphService(new ProjectBrainService(dir))
		try {
			const task1 = makeTask("task-alpha", ["src/a.ts"])
			const task2 = makeTask("task-beta", ["src/b.ts"])
			const task3 = makeTask("task-gamma", ["src/c.ts"])
			await service.upsertTask(task1)
			await service.upsertTask(task2)
			await service.upsertTask(task3)

			const graphWithOrder = await service.load()
			graphWithOrder.executionOrder = [["task-alpha", "task-beta"], ["task-gamma"]]
			await service.save(graphWithOrder)

			const reloaded = await service.load()
			expect(reloaded.executionOrder).toHaveLength(2)
			expect(reloaded.executionOrder[0]).toEqual(["task-alpha", "task-beta"])
			expect(reloaded.executionOrder[1]).toEqual(["task-gamma"])
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("updateStatus changes task status", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-tasks-"))
		const service = new TaskGraphService(new ProjectBrainService(dir))
		try {
			const task = makeTask("status-task", ["src/s.ts"])
			await service.upsertTask(task)
			await service.updateStatus("status-task", "completed")
			const graph = await service.load()
			const found = graph.tasks.find((t) => t.taskId === "status-task")
			expect(found?.status).toBe("completed")
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})
})
