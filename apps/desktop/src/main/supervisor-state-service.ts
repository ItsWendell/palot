import type { ProjectBrainService } from "./project-brain-service"

const SLUG = "supervisor-state"

export interface SubagentOutput {
	sessionId: string
	taskId: string
	summary: string
	completedAt: string
}

export interface SupervisorState {
	version: 1
	currentMilestone: string | null
	completedMilestones: string[]
	activeTaskIds: string[]
	subagentOutputs: Record<string, SubagentOutput>
	updatedAt: string
}

function emptyState(): SupervisorState {
	return {
		version: 1,
		currentMilestone: null,
		completedMilestones: [],
		activeTaskIds: [],
		subagentOutputs: {},
		updatedAt: new Date().toISOString(),
	}
}

function serialize(state: SupervisorState): string {
	return [
		"---",
		`version: ${state.version}`,
		`currentMilestone: ${state.currentMilestone ?? "null"}`,
		`updatedAt: ${state.updatedAt}`,
		"---",
		"",
		`## Completed Milestones`,
		state.completedMilestones.map((m) => `- ${m}`).join("\n") || "_none_",
		"",
		`## Active Tasks`,
		state.activeTaskIds.map((id) => `- ${id}`).join("\n") || "_none_",
		"",
		`## Subagent Outputs`,
		Object.values(state.subagentOutputs)
			.map(
				(o) =>
					`### ${o.taskId} (${o.sessionId})\n_Completed: ${o.completedAt}_\n\n${o.summary}`,
			)
			.join("\n\n") || "_none_",
	].join("\n")
}

function deserialize(content: string): SupervisorState {
	const state = emptyState()

	// Parse frontmatter
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
	if (fmMatch) {
		for (const line of fmMatch[1].split("\n")) {
			const [key, ...rest] = line.split(": ")
			const val = rest.join(": ").trim()
			if (key === "currentMilestone" && val !== "null") state.currentMilestone = val
			if (key === "updatedAt") state.updatedAt = val
		}
	}

	// Parse completed milestones
	const milestonesMatch = content.match(/## Completed Milestones\n([\s\S]*?)(?=\n##|$)/)
	if (milestonesMatch) {
		state.completedMilestones = milestonesMatch[1]
			.split("\n")
			.filter((l) => l.startsWith("- "))
			.map((l) => l.slice(2).trim())
	}

	// Parse active tasks
	const activeMatch = content.match(/## Active Tasks\n([\s\S]*?)(?=\n##|$)/)
	if (activeMatch) {
		state.activeTaskIds = activeMatch[1]
			.split("\n")
			.filter((l) => l.startsWith("- "))
			.map((l) => l.slice(2).trim())
	}

	return state
}

export class SupervisorStateService {
	constructor(private readonly brainService: ProjectBrainService) {}

	async load(): Promise<SupervisorState> {
		const content = await this.brainService.readFile(SLUG)
		if (!content) return emptyState()
		return deserialize(content)
	}

	async save(state: SupervisorState): Promise<void> {
		const updated: SupervisorState = { ...state, updatedAt: new Date().toISOString() }
		await this.brainService.writeFile(SLUG, serialize(updated))
	}

	async appendSubagentOutput(output: SubagentOutput): Promise<SupervisorState> {
		const state = await this.load()
		state.subagentOutputs[output.taskId] = output
		// Remove from active tasks if it was there
		state.activeTaskIds = state.activeTaskIds.filter((id) => id !== output.taskId)
		await this.save(state)
		return state
	}

	async setMilestone(milestone: string): Promise<void> {
		const state = await this.load()
		if (state.currentMilestone && state.currentMilestone !== milestone) {
			state.completedMilestones.push(state.currentMilestone)
		}
		state.currentMilestone = milestone
		await this.save(state)
	}

	async markTaskActive(taskId: string): Promise<void> {
		const state = await this.load()
		if (!state.activeTaskIds.includes(taskId)) {
			state.activeTaskIds.push(taskId)
		}
		await this.save(state)
	}
}
