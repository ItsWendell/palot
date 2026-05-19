import { atom } from "jotai"
import { atomFamily } from "jotai/utils"
import type { SupervisorState, SubagentOutput } from "../../main/supervisor-state-service"

/** Per-project supervisor state. Key is the project directory path. */
export const supervisorStateFamily = atomFamily((_projectPath: string) =>
	atom<SupervisorState | null>(null),
)

/** Load supervisor state from IPC and populate the atom. */
export const loadSupervisorStateAtom = atom(
	null,
	async (
		_get,
		set,
		{ projectPath }: { projectPath: string },
	) => {
		if (typeof window === "undefined" || !("palot" in window)) return
		try {
			const state = await window.palot.supervisor.load(projectPath)
			set(supervisorStateFamily(projectPath), state)
		} catch {
			// Brain directory may not exist yet — start with null
		}
	},
)

/** Write supervisor state through to IPC and update the atom. */
export const saveSupervisorStateAtom = atom(
	null,
	async (
		_get,
		set,
		{ projectPath, state }: { projectPath: string; state: SupervisorState },
	) => {
		set(supervisorStateFamily(projectPath), state)
		if (typeof window === "undefined" || !("palot" in window)) return
		await window.palot.supervisor.save(projectPath, state)
	},
)

/** Append a completed subagent output and refresh local state. */
export const appendSubagentOutputAtom = atom(
	null,
	async (
		_get,
		set,
		{ projectPath, output }: { projectPath: string; output: SubagentOutput },
	) => {
		if (typeof window === "undefined" || !("palot" in window)) return
		const updated = await window.palot.supervisor.appendOutput(projectPath, output)
		set(supervisorStateFamily(projectPath), updated)
	},
)

/** Derived atom: task completion percentage for a project. */
export const supervisorProgressFamily = atomFamily((projectPath: string) =>
	atom((get) => {
		const state = get(supervisorStateFamily(projectPath))
		if (!state) return null
		const total = state.completedMilestones.length + (state.currentMilestone ? 1 : 0)
		if (total === 0) return null
		const completed = state.completedMilestones.length
		return { completed, total, percent: Math.round((completed / total) * 100) }
	}),
)
