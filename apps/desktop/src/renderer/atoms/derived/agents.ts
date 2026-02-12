import { atom } from "jotai"
import { atomFamily } from "jotai-family"
import type { Agent, AgentStatus, SessionStatus, SidebarProject } from "../../lib/types"
import { type DiscoveredProject, type DiscoveredSession, discoveryAtom } from "../discovery"
import { sessionFamily, sessionIdsAtom } from "../sessions"
import { showSubAgentsAtom } from "../ui"

// ============================================================
// Helpers (moved from hooks/use-agents.ts)
// ============================================================

function deriveAgentStatus(
	status: SessionStatus,
	hasPermissions: boolean,
	hasQuestions: boolean,
): AgentStatus {
	if (hasPermissions || hasQuestions) return "waiting"
	switch (status.type) {
		case "busy":
			return "running"
		case "retry":
			return "running"
		case "idle":
			return "idle"
		default:
			return "idle"
	}
}

export function formatRelativeTime(timestampMs: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000))
	if (seconds < 60) return "now"
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h`
	const days = Math.floor(hours / 24)
	if (days < 30) return `${days}d`
	const months = Math.floor(days / 30)
	return `${months}mo`
}

export function formatElapsed(startMs: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000))
	if (seconds < 60) return `${seconds}s`
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = seconds % 60
	if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
	const hours = Math.floor(minutes / 60)
	const remainingMinutes = minutes % 60
	return `${hours}h ${remainingMinutes}m`
}

function projectNameFromDir(directory: string): string {
	return directory.split("/").pop() || "/"
}

// ============================================================
// Project slug system
// ============================================================

interface ProjectEntry {
	id: string
	name: string
	directory: string
}

function buildProjectSlugMap(projects: ProjectEntry[]): Map<string, { id: string; slug: string }> {
	const byDir = new Map<string, ProjectEntry>()
	for (const p of projects) {
		const existing = byDir.get(p.directory)
		if (!existing || (existing.id.startsWith("dir-") && !p.id.startsWith("dir-"))) {
			byDir.set(p.directory, p)
		}
	}

	const result = new Map<string, { id: string; slug: string }>()
	for (const entry of byDir.values()) {
		const slug = `${entry.name}-${entry.id.slice(0, 12)}`
		result.set(entry.directory, { id: entry.id, slug })
	}
	return result
}

function collectAllProjects(
	liveSessionDirs: Map<string, string>,
	discovery: {
		loaded: boolean
		projects: DiscoveredProject[]
		sessions: Record<string, DiscoveredSession[]>
	},
): ProjectEntry[] {
	const entries: ProjectEntry[] = []
	const seenDirs = new Set<string>()

	// Discovery projects
	if (discovery.loaded) {
		for (const project of discovery.projects) {
			if (project.id === "global") {
				const discoverySessions = discovery.sessions[project.id] ?? []
				for (const s of discoverySessions) {
					const dir = s.directory || project.worktree
					if (seenDirs.has(dir)) continue
					seenDirs.add(dir)
					entries.push({
						id: project.id,
						name: projectNameFromDir(dir),
						directory: dir,
					})
				}
			} else {
				entries.push({
					id: project.id,
					name: projectNameFromDir(project.worktree),
					directory: project.worktree,
				})
				seenDirs.add(project.worktree)
			}
		}
	}

	// Live session directories
	for (const [, directory] of liveSessionDirs) {
		if (seenDirs.has(directory)) continue
		if (!directory) continue
		seenDirs.add(directory)
		let hash = 0
		for (let i = 0; i < directory.length; i++) {
			hash = (hash * 31 + directory.charCodeAt(i)) | 0
		}
		entries.push({
			id: `dir-${Math.abs(hash).toString(16).padStart(8, "0")}`,
			name: projectNameFromDir(directory),
			directory,
		})
	}

	return entries
}

// ============================================================
// Derived atom: project slug map (shared by agentsAtom + agentFamily)
// ============================================================

/**
 * Lightweight derived atom that maps directory -> { id, slug }.
 * Only depends on session directories (stable after creation) and discovery
 * (loaded once). This avoids recomputing slugs when session status/permissions change.
 */
const projectSlugMapAtom = atom((get) => {
	const sessionIds = get(sessionIdsAtom)
	const discovery = get(discoveryAtom)

	const liveSessionDirs = new Map<string, string>()
	for (const id of sessionIds) {
		const entry = get(sessionFamily(id))
		if (!entry) continue
		liveSessionDirs.set(id, entry.directory)
	}

	const allProjects = collectAllProjects(liveSessionDirs, discovery)
	return buildProjectSlugMap(allProjects)
})

// ============================================================
// Per-session agent selector (reads ONE sessionFamily atom)
// ============================================================

/**
 * Derives a full `Agent` for a single session. Only subscribes to that session's
 * `sessionFamily` atom + the shared `projectSlugMapAtom`, so status/permission
 * changes on OTHER sessions do not trigger re-derivation.
 */
export const agentFamily = atomFamily((sessionId: string) =>
	atom((get) => {
		const entry = get(sessionFamily(sessionId))
		if (!entry) return null

		const slugMap = get(projectSlugMapAtom)
		const { session, status, permissions, questions, directory } = entry
		const projectInfo = slugMap.get(directory)
		const agentStatus = deriveAgentStatus(status, permissions.length > 0, questions.length > 0)
		const created = session.time.created
		const lastActiveAt = session.time.updated ?? session.time.created

		const agent: Agent = {
			id: session.id,
			sessionId: session.id,
			name: session.title || "Untitled",
			status: agentStatus,
			environment: "local" as const,
			project: projectNameFromDir(directory),
			projectSlug: projectInfo?.slug ?? projectNameFromDir(directory),
			directory,
			branch: entry.branch ?? "",
			duration: formatRelativeTime(lastActiveAt),
			tokens: 0,
			cost: 0,
			currentActivity:
				questions.length > 0
					? `Asking: ${questions[0].questions[0]?.header ?? "Question"}`
					: permissions.length > 0
						? `Waiting for approval: ${permissions[0].title}`
						: status.type === "busy"
							? "Working..."
							: undefined,
			activities: [],
			permissions,
			questions,
			parentId: session.parentID,
			createdAt: created,
			lastActiveAt,
		}
		return agent
	}),
)

/**
 * Reads just the session title for a given session ID.
 * Used for breadcrumb "parent session name" lookups without subscribing
 * to the full agents list.
 */
export const sessionNameFamily = atomFamily((sessionId: string) =>
	atom((get) => {
		const entry = get(sessionFamily(sessionId))
		if (!entry) return undefined
		return entry.session.title || "Untitled"
	}),
)

// ============================================================
// Derived atom: agents list
// ============================================================

export const agentsAtom = atom((get) => {
	const sessionIds = get(sessionIdsAtom)
	const discovery = get(discoveryAtom)
	const slugMap = get(projectSlugMapAtom)
	const agents: Agent[] = []

	const liveSessionIds = new Set<string>()

	// 1. Live sessions -- read via agentFamily for consistency
	for (const id of sessionIds) {
		liveSessionIds.add(id)
		const agent = get(agentFamily(id))
		if (agent) agents.push(agent)
	}

	// 2. Discovered (offline) sessions
	if (discovery.loaded) {
		const projectMap = new Map<string, DiscoveredProject>()
		for (const project of discovery.projects) {
			projectMap.set(project.id, project)
		}

		for (const [projectId, discoverySessions] of Object.entries(discovery.sessions)) {
			const project = projectMap.get(projectId)
			if (!project) continue
			const projectInfo = slugMap.get(project.worktree)

			for (const session of discoverySessions) {
				if (liveSessionIds.has(session.id)) continue
				const lastActiveAt = session.time.updated ?? session.time.created
				const dir = session.directory || project.worktree
				const sessionProjectInfo = slugMap.get(dir) ?? projectInfo

				agents.push({
					id: session.id,
					sessionId: session.id,
					name: session.title || "Untitled",
					status: "completed" as const,
					environment: "local" as const,
					project: projectNameFromDir(dir),
					projectSlug: sessionProjectInfo?.slug ?? projectNameFromDir(dir),
					directory: dir,
					branch: "",
					duration: formatRelativeTime(lastActiveAt),
					tokens: 0,
					cost: 0,
					currentActivity: undefined,
					activities: [],
					permissions: [],
					questions: [],
					parentId: session.parentID,
					createdAt: session.time.created,
					lastActiveAt,
				})
			}
		}
	}

	return agents
})

// ============================================================
// Derived atom: project list for sidebar
// ============================================================

export const projectListAtom = atom((get) => {
	const sessionIds = get(sessionIdsAtom)
	const discovery = get(discoveryAtom)
	const showSubAgents = get(showSubAgentsAtom)
	const slugMap = get(projectSlugMapAtom)

	const liveSessionIds = new Set<string>(sessionIds)

	const projects = new Map<string, SidebarProject>()

	// Live sessions grouped by directory
	for (const id of sessionIds) {
		const entry = get(sessionFamily(id))
		if (!entry) continue
		if (!showSubAgents && entry.session.parentID) continue
		if (!entry.directory) continue

		const dir = entry.directory
		const projectInfo = slugMap.get(dir)
		const name = projectNameFromDir(dir)
		const t = entry.session.time.updated ?? entry.session.time.created ?? 0

		const existing = projects.get(dir)
		if (existing) {
			existing.agentCount += 1
			if (t > existing.lastActiveAt) existing.lastActiveAt = t
		} else {
			projects.set(dir, {
				id: projectInfo?.id ?? dir,
				slug: projectInfo?.slug ?? name,
				name,
				directory: dir,
				agentCount: 1,
				lastActiveAt: t,
			})
		}
	}

	// Discovered projects
	if (discovery.loaded) {
		for (const project of discovery.projects) {
			const discoverySessions = discovery.sessions[project.id] ?? []
			const isGlobal = project.id === "global"

			if (isGlobal) {
				const byDir = new Map<string, { count: number; lastActiveAt: number }>()
				for (const s of discoverySessions) {
					if (liveSessionIds.has(s.id)) continue
					if (!showSubAgents && s.parentID) continue
					const dir = s.directory || project.worktree
					const entry = byDir.get(dir) ?? { count: 0, lastActiveAt: 0 }
					entry.count++
					const t = s.time.updated ?? s.time.created ?? 0
					if (t > entry.lastActiveAt) entry.lastActiveAt = t
					byDir.set(dir, entry)
				}
				for (const [dir, info] of byDir) {
					const projectInfo = slugMap.get(dir)
					const name = projectNameFromDir(dir)
					const existing = projects.get(dir)
					if (existing) {
						existing.agentCount += info.count
						if (info.lastActiveAt > existing.lastActiveAt) existing.lastActiveAt = info.lastActiveAt
					} else if (info.count > 0) {
						projects.set(dir, {
							id: projectInfo?.id ?? project.id,
							slug: projectInfo?.slug ?? name,
							name,
							directory: dir,
							agentCount: info.count,
							lastActiveAt: info.lastActiveAt,
						})
					}
				}
			} else {
				const projectInfo = slugMap.get(project.worktree)
				const name = projectNameFromDir(project.worktree)
				let offlineCount = 0
				let lastActiveAt = projects.get(project.worktree)?.lastActiveAt ?? 0
				for (const s of discoverySessions) {
					if (liveSessionIds.has(s.id)) continue
					if (!showSubAgents && s.parentID) continue
					offlineCount++
					const t = s.time.updated ?? s.time.created ?? 0
					if (t > lastActiveAt) lastActiveAt = t
				}

				if (offlineCount === 0 && !projects.has(project.worktree)) continue

				const existing = projects.get(project.worktree)
				if (existing) {
					existing.agentCount += offlineCount
					if (lastActiveAt > existing.lastActiveAt) existing.lastActiveAt = lastActiveAt
				} else {
					projects.set(project.worktree, {
						id: projectInfo?.id ?? project.id,
						slug: projectInfo?.slug ?? name,
						name,
						directory: project.worktree,
						agentCount: offlineCount,
						lastActiveAt,
					})
				}
			}
		}
	}

	return Array.from(projects.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
})
