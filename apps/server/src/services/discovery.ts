import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

// ============================================================
// Types — mirrors OpenCode's storage format
// ============================================================

export interface DiscoveredProject {
	id: string
	worktree: string
	vcs: string
	time: {
		created: number
		updated?: number
	}
}

export interface DiscoveredSession {
	id: string
	slug?: string
	projectID: string
	directory: string
	parentID?: string
	title: string
	version?: string
	time: {
		created: number
		updated?: number
	}
	summary?: {
		additions: number
		deletions: number
		files: number
	}
}

export interface DiscoveryResult {
	projects: DiscoveredProject[]
	sessions: Record<string, DiscoveredSession[]>
}

// ============================================================
// Paths
// ============================================================

function getStoragePath(): string {
	return join(homedir(), ".local", "share", "opencode", "storage")
}

// ============================================================
// Discovery functions
// ============================================================

/**
 * Reads all project JSON files from OpenCode's storage directory.
 * Skips "global.json" since it's not a real project entry.
 */
async function discoverProjects(storagePath: string): Promise<DiscoveredProject[]> {
	const projectDir = join(storagePath, "project")
	const projects: DiscoveredProject[] = []

	try {
		const files = await readdir(projectDir)
		const jsonFiles = files.filter((f) => f.endsWith(".json") && f !== "global.json")

		const results = await Promise.allSettled(
			jsonFiles.map(async (file) => {
				const filePath = join(projectDir, file)
				const content = await Bun.file(filePath).json()
				return content as DiscoveredProject
			}),
		)

		for (const result of results) {
			if (result.status === "fulfilled" && result.value.id && result.value.worktree) {
				projects.push(result.value)
			}
		}
	} catch (err) {
		console.error("Failed to discover projects:", err)
	}

	return projects
}

/**
 * Reads all session JSON files for a given project ID.
 */
async function discoverSessionsForProject(
	storagePath: string,
	projectId: string,
): Promise<DiscoveredSession[]> {
	const sessionDir = join(storagePath, "session", projectId)
	const sessions: DiscoveredSession[] = []

	try {
		const files = await readdir(sessionDir)
		const jsonFiles = files.filter((f) => f.endsWith(".json"))

		const results = await Promise.allSettled(
			jsonFiles.map(async (file) => {
				const filePath = join(sessionDir, file)
				const content = await Bun.file(filePath).json()
				return content as DiscoveredSession
			}),
		)

		for (const result of results) {
			if (result.status === "fulfilled" && result.value.id && result.value.title) {
				// Skip subagent sessions (they have a parentID)
				if (!result.value.parentID) {
					sessions.push(result.value)
				}
			}
		}
	} catch (err) {
		// Directory might not exist for some projects
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			console.error(`Failed to discover sessions for project ${projectId}:`, err)
		}
	}

	return sessions
}

/**
 * Full discovery: scans all projects and their sessions from OpenCode's
 * local storage at ~/.local/share/opencode/storage/
 */
export async function discover(): Promise<DiscoveryResult> {
	const storagePath = getStoragePath()
	const projects = await discoverProjects(storagePath)

	// Load sessions for all projects in parallel
	const sessionEntries = await Promise.all(
		projects.map(async (project) => {
			const sessions = await discoverSessionsForProject(storagePath, project.id)
			return [project.id, sessions] as const
		}),
	)

	const sessions: Record<string, DiscoveredSession[]> = {}
	for (const [projectId, projectSessions] of sessionEntries) {
		if (projectSessions.length > 0) {
			sessions[projectId] = projectSessions
		}
	}

	return { projects, sessions }
}
