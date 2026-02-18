import { atom } from "jotai"
import { atomFamily } from "jotai-family"
import type {
	Agent,
	AgentStatus,
	OpenCodeProject,
	SessionStatus,
	SidebarProject,
} from "../../lib/types"
import { discoveryAtom } from "../discovery"
import { sessionFamily, sessionIdsAtom } from "../sessions"

// ============================================================
// Structural equality for Agent objects
// ============================================================

/**
 * Shallow-compare two Agent objects by their identity and UI-relevant fields.
 * Arrays like `permissions` and `questions` are compared by length + first-element
 * identity, which is sufficient since they come from the same atom and are replaced
 * wholesale on updates.
 */
function agentEqual(prev: Agent | null, next: Agent | null): boolean {
	if (prev === next) return true
	if (!prev || !next) return false
	return (
		prev.id === next.id &&
		prev.name === next.name &&
		prev.status === next.status &&
		prev.project === next.project &&
		prev.projectSlug === next.projectSlug &&
		prev.directory === next.directory &&
		prev.projectDirectory === next.projectDirectory &&
		prev.branch === next.branch &&
		prev.duration === next.duration &&
		prev.currentActivity === next.currentActivity &&
		prev.parentId === next.parentId &&
		prev.worktreePath === next.worktreePath &&
		prev.worktreeBranch === next.worktreeBranch &&
		prev.createdAt === next.createdAt &&
		prev.lastActiveAt === next.lastActiveAt &&
		prev.permissions.length === next.permissions.length &&
		prev.questions.length === next.questions.length &&
		prev.permissions[0] === next.permissions[0] &&
		prev.questions[0] === next.questions[0]
	)
}

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

// ============================================================
// Sandbox (worktree) directory mapping
// ============================================================

/**
 * Builds a set of all sandbox directories across all discovered projects.
 * A "sandbox" is a worktree directory that belongs to a parent project.
 * These should not appear as top-level projects in the sidebar.
 */
function buildSandboxDirSet(projects: OpenCodeProject[]): Set<string> {
	const sandboxDirs = new Set<string>()
	for (const project of projects) {
		if (project.sandboxes) {
			for (const dir of project.sandboxes) {
				sandboxDirs.add(dir)
			}
		}
	}
	return sandboxDirs
}

/**
 * Builds a map from sandbox directory -> parent project worktree directory.
 * Used to remap sessions running in a sandbox back to their parent project.
 */
function buildSandboxToParentMap(projects: OpenCodeProject[]): Map<string, string> {
	const map = new Map<string, string>()
	for (const project of projects) {
		if (!project.worktree || !project.sandboxes) continue
		for (const dir of project.sandboxes) {
			map.set(dir, project.worktree)
		}
	}
	return map
}

/**
 * Builds a map from parent project directory -> set of its sandbox directories.
 * Used by projectSessionIdsFamily to include sandbox sessions under the parent.
 */
function buildParentToSandboxesMap(projects: OpenCodeProject[]): Map<string, Set<string>> {
	const map = new Map<string, Set<string>>()
	for (const project of projects) {
		if (!project.worktree || !project.sandboxes?.length) continue
		map.set(project.worktree, new Set(project.sandboxes))
	}
	return map
}

function collectAllProjects(
	liveSessionDirs: Map<string, string>,
	discovery: {
		loaded: boolean
		projects: OpenCodeProject[]
	},
): ProjectEntry[] {
	const entries: ProjectEntry[] = []
	const seenDirs = new Set<string>()

	// Build sandbox set to filter out worktree projects
	const sandboxDirs = discovery.loaded ? buildSandboxDirSet(discovery.projects) : new Set<string>()

	// Discovery projects (from API), excluding sandboxes
	if (discovery.loaded) {
		for (const project of discovery.projects) {
			if (!project.worktree || seenDirs.has(project.worktree)) continue
			if (sandboxDirs.has(project.worktree)) continue
			seenDirs.add(project.worktree)
			entries.push({
				id: project.id,
				name: project.name ?? projectNameFromDir(project.worktree),
				directory: project.worktree,
			})
		}
	}

	// Live session directories (may include directories not in any project).
	// Skip directories that are sandboxes of a known project.
	for (const [, directory] of liveSessionDirs) {
		if (seenDirs.has(directory)) continue
		if (!directory) continue
		if (sandboxDirs.has(directory)) continue
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
// Derived atoms: sandbox mappings + project slug map
// ============================================================

/**
 * Derived atom that computes sandbox directory mappings from discovery data.
 * Only recomputes when discovery changes (loaded once per connection).
 *
 * - `sandboxToParent`: maps sandbox dir -> parent project dir
 * - `parentToSandboxes`: maps parent project dir -> set of sandbox dirs
 *
 * Used by projectSessionIdsFamily (to absorb sandbox sessions into parent)
 * and agentFamily (to remap project name/slug for sandbox sessions).
 */
export const sandboxMappingsAtom = atom((get) => {
	const discovery = get(discoveryAtom)
	if (!discovery.loaded) {
		return {
			sandboxToParent: new Map<string, string>(),
			parentToSandboxes: new Map<string, Set<string>>(),
		}
	}
	return {
		sandboxToParent: buildSandboxToParentMap(discovery.projects),
		parentToSandboxes: buildParentToSandboxesMap(discovery.projects),
	}
})

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
export const agentFamily = atomFamily((sessionId: string) => {
	let prev: Agent | null = null
	return atom((get) => {
		const entry = get(sessionFamily(sessionId))
		if (!entry) {
			prev = null
			return null
		}

		const slugMap = get(projectSlugMapAtom)
		const { sandboxToParent } = get(sandboxMappingsAtom)
		const { session, status, permissions, questions, directory } = entry
		const agentStatus = deriveAgentStatus(status, permissions.length > 0, questions.length > 0)
		const created = session.time.created
		const lastActiveAt = session.time.updated ?? session.time.created

		// If this session's directory is a sandbox (worktree), resolve the parent
		// project directory for name/slug display so it groups visually under the parent.
		const parentDir = sandboxToParent.get(directory)
		const displayDir = parentDir ?? directory
		const projectInfo = slugMap.get(displayDir)

		const next: Agent = {
			id: session.id,
			sessionId: session.id,
			name: session.title || "Untitled",
			status: agentStatus,
			environment: "local" as const,
			project: projectNameFromDir(displayDir),
			projectSlug: projectInfo?.slug ?? projectNameFromDir(displayDir),
			directory,
			projectDirectory: displayDir,
			branch: entry.branch ?? "",
			duration: formatRelativeTime(lastActiveAt),
			currentActivity:
				questions.length > 0
					? `Asking: ${questions[0].questions[0]?.header ?? "Question"}`
					: permissions.length > 0
						? `Waiting for approval: ${permissions[0].permission}`
						: status.type === "busy"
							? "Working..."
							: undefined,
			activities: [],
			permissions,
			questions,
			parentId: session.parentID,
			worktreePath: entry.worktreePath,
			worktreeBranch: entry.worktreeBranch,
			createdAt: created,
			lastActiveAt,
		}

		// Return the previous reference if structurally equal to avoid
		// downstream memo() invalidation in SessionItem and friends.
		if (agentEqual(prev, next)) return prev!
		prev = next
		return next
	})
})

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

/**
 * All agents derived from live sessions.
 * With API-first discovery, there are no more "offline-only" discovered sessions
 * since sessions are loaded directly from the API into the session atom family.
 *
 * Uses structural equality on the array elements so downstream subscribers
 * (SidebarLayout, CommandPalette) don't re-render when individual agent
 * references are stable.
 */
export const agentsAtom = (() => {
	let prevAgents: Agent[] = []
	return atom((get) => {
		const sessionIds = get(sessionIdsAtom)
		const agents: Agent[] = []

		for (const id of sessionIds) {
			const agent = get(agentFamily(id))
			if (agent) agents.push(agent)
		}

		// Return the previous array if every element is referentially identical.
		// This is cheap because agentFamily already stabilizes references.
		if (agents.length === prevAgents.length && agents.every((a, i) => a === prevAgents[i])) {
			return prevAgents
		}
		prevAgents = agents
		return agents
	})
})()

// ============================================================
// Per-project session IDs for granular sidebar subscriptions
// ============================================================

/**
 * Returns the list of session IDs belonging to a specific project directory.
 * Keyed by directory path. Each ProjectFolder subscribes to its own family
 * member, so adding/removing sessions in project A does not re-render project B.
 *
 * Also includes sessions running in sandbox (worktree) directories that belong
 * to this project, so worktree sessions appear under the parent project.
 *
 * Uses structural equality on the array to avoid unnecessary re-renders
 * when the same set of IDs is returned.
 */
export const projectSessionIdsFamily = atomFamily((directory: string) => {
	let prev: string[] = []
	return atom((get) => {
		const sessionIds = get(sessionIdsAtom)
		const { parentToSandboxes } = get(sandboxMappingsAtom)

		// Directories that belong to this project: the project dir itself + its sandboxes
		const sandboxes = parentToSandboxes.get(directory)

		const ids: string[] = []
		for (const id of sessionIds) {
			const entry = get(sessionFamily(id))
			if (!entry) continue
			// Hide sub-agent sessions in the sidebar (they still exist in the store
			// for message/part lookups and direct navigation)
			if (entry.session.parentID) continue
			// Match the project directory itself, or any of its sandbox directories
			if (entry.directory !== directory && !sandboxes?.has(entry.directory)) continue
			ids.push(id)
		}
		// Structural equality: return previous array if contents are the same
		if (ids.length === prev.length && ids.every((id, i) => id === prev[i])) {
			return prev
		}
		prev = ids
		return ids
	})
})

// ============================================================
// Derived atom: project list for sidebar
// ============================================================

export const projectListAtom = (() => {
	let prevProjects: SidebarProject[] = []

	function projectListEqual(a: SidebarProject[], b: SidebarProject[]): boolean {
		if (a.length !== b.length) return false
		for (let i = 0; i < a.length; i++) {
			const pa = a[i]
			const pb = b[i]
			if (
				pa.id !== pb.id ||
				pa.slug !== pb.slug ||
				pa.name !== pb.name ||
				pa.directory !== pb.directory ||
				pa.agentCount !== pb.agentCount ||
				pa.lastActiveAt !== pb.lastActiveAt ||
				pa.hasActiveAgent !== pb.hasActiveAgent
			) {
				return false
			}
		}
		return true
	}

	return atom((get) => {
		const sessionIds = get(sessionIdsAtom)
		const discovery = get(discoveryAtom)
		const slugMap = get(projectSlugMapAtom)
		const { sandboxToParent } = get(sandboxMappingsAtom)

		const projects = new Map<string, SidebarProject>()

		// Live sessions grouped by directory.
		// Sessions in sandbox directories are counted under their parent project.
		// Sub-agent sessions are excluded from sidebar counts (they arrive via SSE
		// but are only relevant for message/part lookups and direct navigation).
		//
		// Sort key uses session timestamps only (not project.time.updated from the
		// API, which is volatile and changes from server metadata operations, causing
		// random reordering even when no user activity occurs).
		for (const id of sessionIds) {
			const entry = get(sessionFamily(id))
			if (!entry) continue
			if (entry.session.parentID) continue
			if (!entry.directory) continue

			// Remap sandbox directories to their parent project
			const parentDir = sandboxToParent.get(entry.directory)
			const dir = parentDir ?? entry.directory
			const projectInfo = slugMap.get(dir)
			const name = projectNameFromDir(dir)
			const sessionTime = entry.session.time.updated ?? entry.session.time.created ?? 0

			// A session is "active" if it is busy or has pending permissions/questions
			const isActive =
				entry.status.type === "busy" ||
				entry.permissions.length > 0 ||
				entry.questions.length > 0

			const existing = projects.get(dir)
			if (existing) {
				existing.agentCount += 1
				if (sessionTime > existing.lastActiveAt) existing.lastActiveAt = sessionTime
				if (isActive) existing.hasActiveAgent = true
			} else {
				projects.set(dir, {
					id: projectInfo?.id ?? dir,
					slug: projectInfo?.slug ?? name,
					name,
					directory: dir,
					agentCount: 1,
					lastActiveAt: sessionTime,
					hasActiveAgent: isActive,
				})
			}
		}

		// Build sandbox set to filter out worktree projects from discovery
		const sandboxDirs = discovery.loaded
			? buildSandboxDirSet(discovery.projects)
			: new Set<string>()

		// Discovered projects from API that have no live sessions yet
		// (show them in sidebar so users can start new agents).
		// Skip sandbox projects -- they belong under their parent.
		// These get lastActiveAt = 0 so they sort alphabetically at the bottom
		// (tier 3), avoiding instability from volatile project.time.updated.
		if (discovery.loaded) {
			for (const project of discovery.projects) {
				if (!project.worktree) continue
				if (projects.has(project.worktree)) continue
				if (sandboxDirs.has(project.worktree)) continue

				const projectInfo = slugMap.get(project.worktree)
				const name = project.name ?? projectNameFromDir(project.worktree)

				projects.set(project.worktree, {
					id: projectInfo?.id ?? project.id,
					slug: projectInfo?.slug ?? name,
					name,
					directory: project.worktree,
					agentCount: 0,
					lastActiveAt: 0,
					hasActiveAgent: false,
				})
			}
		}

		// Tiered sort for stable, predictable ordering:
		//   Tier 1: Projects with active agents (running/waiting) — by recency
		//   Tier 2: Projects with idle sessions — by recency
		//   Tier 3: Projects with no sessions — alphabetical by name
		// Within each tier, ties are broken by name for deterministic ordering.
		const next = Array.from(projects.values()).sort((a, b) => {
			const tierA = a.hasActiveAgent ? 0 : a.agentCount > 0 ? 1 : 2
			const tierB = b.hasActiveAgent ? 0 : b.agentCount > 0 ? 1 : 2
			if (tierA !== tierB) return tierA - tierB

			// Within tiers 0 and 1: sort by most recent activity, then name
			if (tierA < 2) {
				const timeDiff = b.lastActiveAt - a.lastActiveAt
				if (timeDiff !== 0) return timeDiff
			}

			// Tier 2 (no sessions) or tie-breaker: alphabetical by name
			return a.name.localeCompare(b.name)
		})

		if (projectListEqual(prevProjects, next)) return prevProjects
		prevProjects = next
		return next
	})
})()
