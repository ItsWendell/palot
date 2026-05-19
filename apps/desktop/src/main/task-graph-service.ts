import type { ProjectBrainService } from "./project-brain-service"
import type {
	BrainTask,
	ExecutionPlan,
	FileOwnershipConflict,
	TaskGraph,
	TaskStatus,
} from "../shared/tasks"

const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/

function emptyGraph(): TaskGraph {
	const now = new Date().toISOString()
	return { tasks: [], executionOrder: [], createdAt: now, updatedAt: now }
}

function parseTableRows(markdown: string): string[][] {
	const rows: string[][] = []
	for (const line of markdown.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed.startsWith("|") || /^\|[-: |]+\|$/.test(trimmed)) continue
		const cells = trimmed
			.slice(1, -1)
			.split("|")
			.map((c) => c.trim())
		if (cells.length > 1) rows.push(cells)
	}
	return rows
}

function parseListCell(cell: string): string[] {
	if (!cell || cell === "") return []
	return cell
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
}

function executionOrderFromMarkdown(content: string): string[][] {
	const match = content.match(/## Execution Order\n+([\s\S]*?)(?:\n##|$)/)
	if (!match) return []
	const groups: string[][] = []
	for (const line of match[1].split("\n")) {
		const trimmed = line.trim()
		if (!trimmed.startsWith("-")) continue
		const colonIdx = trimmed.indexOf(":")
		if (colonIdx === -1) continue
		const ids = trimmed
			.slice(colonIdx + 1)
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
		if (ids.length > 0) groups.push(ids)
	}
	return groups
}

function tasksFromMarkdown(content: string): BrainTask[] {
	const body = content.replace(FRONTMATTER_PATTERN, "")
	const rows = parseTableRows(body)
	if (rows.length === 0) return []

	// Skip header row (first row) — header row contains column names
	return rows.slice(1).map((cells) => {
		const [taskId = "", title = "", role = "", status = "", dependencies = "", estimatedComplexity = "", recommendedModel = "", filesOwned = ""] = cells
		return {
			taskId,
			title,
			description: "",
			role: (role as BrainTask["role"]) || "builder",
			status: (status as TaskStatus) || "pending",
			dependencies: parseListCell(dependencies),
			filesOwned: parseListCell(filesOwned),
			estimatedComplexity: (estimatedComplexity as BrainTask["estimatedComplexity"]) || "medium",
			recommendedModel,
			contextRequired: [],
			outputRequired: [],
			validationCommands: [],
		}
	}).filter((t) => t.taskId !== "")
}

function graphToMarkdown(graph: TaskGraph, existing: string | null): string {
	const frontmatter = existing?.match(/^(---\n[\s\S]*?\n---\n?)/)
		?.[1] ?? "---\ntitle: Task Graph\ntags: [tasks, planning]\nupdated: " + new Date().toISOString().slice(0, 10) + "\n---\n\n"

	const header = "# Task Graph\n\n## Pending Tasks\n\n| taskId | title | role | status | dependencies | estimatedComplexity | recommendedModel | filesOwned |\n|--------|-------|------|--------|-------------|---------------------|-----------------|-----------|\n"

	const rows = graph.tasks
		.map(
			(t) =>
				`| ${t.taskId} | ${t.title} | ${t.role} | ${t.status} | ${t.dependencies.join(", ")} | ${t.estimatedComplexity} | ${t.recommendedModel} | ${t.filesOwned.join(", ")} |`,
		)
		.join("\n")

	const groups = graph.executionOrder
		.map((group, i) => `- Group ${i + 1}: ${group.join(", ")}`)
		.join("\n")

	const orderSection = graph.executionOrder.length > 0
		? `\n\n## Execution Order\n\n${groups}`
		: ""

	return `${frontmatter}${header}${rows}${orderSection}\n`
}

export class TaskGraphService {
	constructor(private readonly brainService: ProjectBrainService) {}

	async load(): Promise<TaskGraph> {
		const content = await this.brainService.readFile("tasks")
		if (!content) return emptyGraph()
		return {
			tasks: tasksFromMarkdown(content),
			executionOrder: executionOrderFromMarkdown(content),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}
	}

	async save(graph: TaskGraph): Promise<void> {
		const existing = await this.brainService.readFile("tasks")
		const updated: TaskGraph = { ...graph, updatedAt: new Date().toISOString() }
		await this.brainService.writeFile("tasks", graphToMarkdown(updated, existing))
	}

	async upsertTask(task: BrainTask): Promise<TaskGraph> {
		const graph = await this.load()
		const idx = graph.tasks.findIndex((t) => t.taskId === task.taskId)
		if (idx >= 0) {
			graph.tasks[idx] = task
		} else {
			graph.tasks.push(task)
		}
		const updated: TaskGraph = { ...graph, updatedAt: new Date().toISOString() }
		await this.save(updated)
		return updated
	}

	async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
		const graph = await this.load()
		const task = graph.tasks.find((t) => t.taskId === taskId)
		if (task) {
			task.status = status
			await this.save({ ...graph, updatedAt: new Date().toISOString() })
		}
	}

	detectConflicts(tasks: BrainTask[]): FileOwnershipConflict[] {
		const fileToTasks = new Map<string, string[]>()
		for (const task of tasks) {
			for (const file of task.filesOwned) {
				const existing = fileToTasks.get(file) ?? []
				existing.push(task.taskId)
				fileToTasks.set(file, existing)
			}
		}
		const conflicts: FileOwnershipConflict[] = []
		for (const [file, taskIds] of fileToTasks) {
			if (taskIds.length > 1) {
				conflicts.push({ file, conflictingTasks: taskIds })
			}
		}
		return conflicts
	}

	buildExecutionPlan(tasks: BrainTask[]): ExecutionPlan {
		const graph = emptyGraph()
		graph.tasks = tasks

		const conflicts = this.detectConflicts(tasks)

		if (conflicts.length > 0) {
			return {
				graph,
				conflicts,
				safe: false,
				recommendation: "blocked",
				reason: `${conflicts.length} file ownership conflict(s) detected: ${conflicts.map((c) => c.file).join(", ")}`,
			}
		}

		const allFiles = tasks.flatMap((t) => t.filesOwned)
		const uniqueFiles = new Set(allFiles)
		const parallel = allFiles.length === uniqueFiles.size

		if (parallel) {
			return {
				graph,
				conflicts: [],
				safe: true,
				recommendation: "parallel",
				reason: "All tasks have disjoint file ownership.",
			}
		}

		return {
			graph,
			conflicts: [],
			safe: true,
			recommendation: "sequential",
			reason: "Tasks share files and must run sequentially.",
		}
	}
}
