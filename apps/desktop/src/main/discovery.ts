import { readdir, readFile } from "node:fs/promises"
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
// Helpers
// ============================================================

function getStoragePath(): string {
	return join(homedir(), ".local", "share", "opencode", "storage")
}

async function readJson<T>(filePath: string): Promise<T> {
	const content = await readFile(filePath, "utf-8")
	return JSON.parse(content) as T
}

// ============================================================
// Discovery functions
// ============================================================

async function discoverProjects(storagePath: string): Promise<DiscoveredProject[]> {
	const projectDir = join(storagePath, "project")
	const projects: DiscoveredProject[] = []

	try {
		const files = await readdir(projectDir)
		const jsonFiles = files.filter((f) => f.endsWith(".json"))

		const results = await Promise.allSettled(
			jsonFiles.map((file) => readJson<DiscoveredProject>(join(projectDir, file))),
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
			jsonFiles.map((file) => readJson<DiscoveredSession>(join(sessionDir, file))),
		)

		for (const result of results) {
			if (result.status === "fulfilled" && result.value.id && result.value.title) {
				if (!result.value.parentID) {
					sessions.push(result.value)
				}
			}
		}
	} catch (err) {
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
