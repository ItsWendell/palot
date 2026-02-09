import { useMemo } from "react"
import type { Agent, AgentStatus, SessionStatus, SidebarProject } from "../lib/types"
import type { DiscoveredProject } from "../stores/app-store"
import { useAppStore } from "../stores/app-store"
import { usePersistedStore } from "../stores/persisted-store"

/**
 * Maps an OpenCode SessionStatus to our UI AgentStatus.
 */
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
			return "running" // still in progress, just retrying
		case "idle":
			return "idle"
		default:
			return "idle"
	}
}

/**
 * Formats a timestamp as relative time ("just now", "5m ago", "2h ago", "3d ago").
 */
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

/**
 * Formats elapsed working time for active sessions ("12s", "3m 24s").
 */
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

/**
 * Extracts the project name from a directory path.
 */
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

/**
 * Builds a Map<directory, { id, slug }> for all known projects.
 * Slug format is always `{name}-{id.slice(0,12)}` for stability —
 * slugs never change when new projects appear.
 * 12 hex chars = 48 bits, collision-safe up to ~16 million projects.
 */
function buildProjectSlugMap(projects: ProjectEntry[]): Map<string, { id: string; slug: string }> {
	// Deduplicate by directory (prefer entries with a real project ID)
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

/**
 * Collects all unique project entries from sessions and discovery.
 * Used as input to buildProjectSlugMap.
 */
function collectAllProjects(
	sessions: Record<string, { directory: string }>,
	discovery: {
		loaded: boolean
		projects: DiscoveredProject[]
		sessions: Record<string, import("../stores/app-store").DiscoveredSession[]>
	},
): ProjectEntry[] {
	const entries: ProjectEntry[] = []
	const seenDirs = new Set<string>()

	// Discovery projects have real IDs (root commit hash)
	if (discovery.loaded) {
		for (const project of discovery.projects) {
			if (project.id === "global") {
				// Global project: derive entries from each session's actual directory
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

	// Live session directories — use directory hash as fallback ID
	for (const entry of Object.values(sessions)) {
		if (seenDirs.has(entry.directory)) continue
		if (!entry.directory) continue
		seenDirs.add(entry.directory)
		let hash = 0
		for (let i = 0; i < entry.directory.length; i++) {
			hash = (hash * 31 + entry.directory.charCodeAt(i)) | 0
		}
		entries.push({
			id: `dir-${Math.abs(hash).toString(16).padStart(8, "0")}`,
			name: projectNameFromDir(entry.directory),
			directory: entry.directory,
		})
	}

	return entries
}

/**
 * Hook that returns agents derived from live server sessions + discovered sessions.
 *
 * IMPORTANT: We select raw store references and compute agents inside useMemo.
 * This avoids the "getSnapshot must be cached" infinite loop with React 19.
 */
export function useAgents(): Agent[] {
	const sessions = useAppStore((s) => s.sessions ?? {})
	const discovery = useAppStore((s) => s.discovery)

	return useMemo(() => {
		const agents: Agent[] = []

		// Build project slug map for all projects
		const allProjects = collectAllProjects(sessions, discovery)
		const slugMap = buildProjectSlugMap(allProjects)

		// Collect IDs of sessions that are live (from the store)
		const liveSessionIds = new Set<string>()

		// 1. Live sessions — these take priority
		for (const entry of Object.values(sessions)) {
			const { session, status, permissions, questions, directory } = entry
			liveSessionIds.add(session.id)
			const projectInfo = slugMap.get(directory)
			const agentStatus = deriveAgentStatus(status, permissions.length > 0, questions.length > 0)

			const created = session.time.created
			const lastActiveAt = session.time.updated ?? session.time.created

			agents.push({
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
			})
		}

		// 2. Discovered (offline) sessions — only if not already live
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
	}, [sessions, discovery])
}

/**
 * Hook that returns the project list for the sidebar.
 * Merges live server projects with discovered projects.
 * Keys by project ID (not name) to handle multiple repos with the same folder name.
 * Respects the showSubAgents toggle — when hidden, sub-agent sessions
 * are excluded from counts.
 */
export function useProjectList(): SidebarProject[] {
	const sessions = useAppStore((s) => s.sessions ?? {})
	const discovery = useAppStore((s) => s.discovery)
	const showSubAgents = useAppStore((s) => s.ui?.showSubAgents ?? false)

	return useMemo(() => {
		// Build project slug map for all projects
		const allProjects = collectAllProjects(sessions, discovery)
		const slugMap = buildProjectSlugMap(allProjects)

		// Key by directory (which is unique per project)
		const projects = new Map<string, SidebarProject>()

		// Live sessions grouped by directory
		const liveSessionIds = new Set<string>()
		for (const entry of Object.values(sessions)) {
			liveSessionIds.add(entry.session.id)
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

		// Discovered projects — add sessions not already counted from live sessions
		if (discovery.loaded) {
			for (const project of discovery.projects) {
				const discoverySessions = discovery.sessions[project.id] ?? []
				const isGlobal = project.id === "global"

				if (isGlobal) {
					// Global project: group sessions by their actual directory
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
							if (info.lastActiveAt > existing.lastActiveAt)
								existing.lastActiveAt = info.lastActiveAt
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
	}, [sessions, discovery, showSubAgents])
}

/**
 * Individual UI selectors — use these directly instead of a single object
 * to avoid unnecessary re-renders from object spreading.
 */
export const useCommandPaletteOpen = () => useAppStore((s) => s.ui.commandPaletteOpen)
export const useSetCommandPaletteOpen = () => useAppStore((s) => s.setCommandPaletteOpen)
export const useShowSubAgents = () => useAppStore((s) => s.ui.showSubAgents)
export const useToggleShowSubAgents = () => useAppStore((s) => s.toggleShowSubAgents)
export const useDisplayMode = () => usePersistedStore((s) => s.displayMode)
export const useSetDisplayMode = () => usePersistedStore((s) => s.setDisplayMode)
