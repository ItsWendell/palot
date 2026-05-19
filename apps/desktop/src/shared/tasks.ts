export type TaskRole = "architect" | "builder" | "reviewer" | "fixer" | "docs"
export type TaskStatus = "pending" | "running" | "blocked" | "completed" | "failed"
export type TaskComplexity = "low" | "medium" | "high"

export interface BrainTask {
	taskId: string
	title: string
	description: string
	role: TaskRole
	status: TaskStatus
	dependencies: string[]
	filesOwned: string[]
	estimatedComplexity: TaskComplexity
	recommendedModel: string
	contextRequired: string[]
	outputRequired: string[]
	validationCommands: string[]
}

export interface TaskGraph {
	tasks: BrainTask[]
	executionOrder: string[][]
	createdAt: string
	updatedAt: string
}

export interface FileOwnershipConflict {
	file: string
	conflictingTasks: string[]
}

export interface ExecutionPlan {
	graph: TaskGraph
	conflicts: FileOwnershipConflict[]
	safe: boolean
	recommendation: "sequential" | "parallel" | "blocked"
	reason: string
}
