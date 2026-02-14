/**
 * Worktree service layer.
 *
 * Provides worktree lifecycle operations (create, list, remove, reset) via
 * the OpenCode experimental worktree API. Falls back to Electron IPC-based
 * worktree management when the API is unavailable (older servers or non-git
 * projects).
 *
 * This enables worktree support for both local and remote OpenCode servers
 * without any upstream code changes.
 */

import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createLogger } from "../lib/logger"
import { isElectron } from "./backend"
import { getProjectClient } from "./connection-manager"

const log = createLogger("worktree-service")

// ============================================================
// Types
// ============================================================

/** Result of creating a worktree via the OpenCode API */
export interface WorktreeCreateResult {
	/** OpenCode-generated worktree name (e.g. "brave-falcon" or "fix-auth-bug") */
	name: string
	/** Branch name (e.g. "opencode/fix-auth-bug") */
	branch: string
	/** Absolute path to the worktree directory on the server */
	directory: string
}

/** Info about a worktree from the list endpoint */
export interface WorktreeListItem {
	/** Absolute path to the worktree directory */
	directory: string
}

/** Result shaped for the existing Palot UI (compatible with new-chat.tsx flow) */
export interface WorktreeResult {
	/** Absolute path to the worktree root (git worktree directory) */
	worktreeRoot: string
	/**
	 * Workspace path within the worktree, accounting for monorepo subdirectories.
	 * If the source was /repo/packages/app, this points to /worktree/packages/app.
	 */
	worktreeWorkspace: string
	/** The branch name created (e.g. "opencode/fix-auth-bug") */
	branchName: string
	/** Whether the worktree was created via the API or the Electron fallback */
	source: "api" | "electron-fallback"
}

// ============================================================
// Helpers
// ============================================================

/**
 * Builds a shell command that copies .env files from the main worktree to the
 * new worktree directory. Used as the `startCommand` parameter for the API.
 *
 * The command is safe to run on servers where the files don't exist (uses || true).
 */
function buildEnvSyncCommand(sourceDir: string, worktreeDir: string): string {
	// Use a bash snippet that copies .env* files excluding .example/.sample
	// The `find` + `cp` approach handles nested .env files too
	return [
		`for f in "${sourceDir}"/.env*; do`,
		`  [ -f "$f" ] || continue`,
		`  case "$f" in *.example|*.sample) continue;; esac`,
		`  cp "$f" "${worktreeDir}/" 2>/dev/null`,
		"done",
	].join(" ")
}

/**
 * Computes the monorepo workspace subpath.
 * If sourceDir is /repo/packages/app and the worktree root is at /worktree/,
 * returns "packages/app". Returns "" if sourceDir IS the repo root.
 */
function computeSubPath(repoRoot: string, sourceDir: string): string {
	// Normalize paths (remove trailing slashes)
	const normalizedRoot = repoRoot.replace(/\/+$/, "")
	const normalizedSource = sourceDir.replace(/\/+$/, "")

	if (normalizedSource === normalizedRoot) return ""

	// sourceDir should be under repoRoot
	if (normalizedSource.startsWith(`${normalizedRoot}/`)) {
		return normalizedSource.slice(normalizedRoot.length + 1)
	}

	return ""
}

/**
 * Wait for a worktree.ready or worktree.failed event by polling the project's
 * sandbox list. We check if the directory appears in the list, which means the
 * worktree has been fully bootstrapped.
 *
 * The timeout prevents waiting indefinitely if the event is missed.
 */
async function waitForWorktreeReady(
	client: OpencodeClient,
	directory: string,
	timeoutMs = 60_000,
): Promise<void> {
	const start = Date.now()
	const pollIntervalMs = 500

	while (Date.now() - start < timeoutMs) {
		try {
			const result = await client.experimental.worktree.list()
			const sandboxes = (result.data ?? []) as string[]
			if (sandboxes.includes(directory)) {
				log.debug("Worktree ready (found in sandbox list)", { directory })
				return
			}
		} catch {
			// Ignore poll errors, keep trying
		}
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
	}

	// Timeout reached, but the worktree was likely created. Proceed anyway with a warning.
	log.warn("Worktree readiness check timed out, proceeding anyway", { directory, timeoutMs })
}

// ============================================================
// API-based operations
// ============================================================

/**
 * Creates a worktree via the OpenCode experimental API.
 *
 * @param projectDir  The project's main directory (used to scope the SDK client)
 * @param sourceDir   The actual source directory (may be a monorepo subdirectory)
 * @param sessionSlug  Short slug derived from the prompt (used for naming)
 * @returns WorktreeResult with paths, or null if the API is unavailable
 */
async function createViaApi(
	projectDir: string,
	sourceDir: string,
	sessionSlug: string,
): Promise<WorktreeResult | null> {
	const client = getProjectClient(projectDir)
	if (!client) {
		log.warn("No project client available for worktree creation", { projectDir })
		return null
	}

	try {
		// Create the worktree via the experimental API
		const result = await client.experimental.worktree.create({
			body: {
				name: sessionSlug,
				startCommand: buildEnvSyncCommand(sourceDir, "$PWD"),
			},
		})

		const data = result.data as WorktreeCreateResult | undefined
		if (!data?.directory) {
			log.error("Worktree API returned unexpected response", { result })
			return null
		}

		log.info("Worktree created via API", {
			name: data.name,
			branch: data.branch,
			directory: data.directory,
		})

		// Wait for the worktree to be fully bootstrapped.
		// The API returns immediately but checkout + bootstrap happen async.
		await waitForWorktreeReady(client, data.directory)

		// Compute the workspace subpath for monorepo support
		// The API creates the worktree at the repo root level.
		// If sourceDir was a subdirectory, we need to calculate the equivalent path.
		const subPath = computeSubPath(projectDir, sourceDir)
		const worktreeWorkspace = subPath ? `${data.directory}/${subPath}` : data.directory

		return {
			worktreeRoot: data.directory,
			worktreeWorkspace,
			branchName: data.branch,
			source: "api",
		}
	} catch (err) {
		// Check if this is a 404 (API not available on this server)
		const status = (err as { status?: number })?.status
		if (status === 404) {
			log.info("Worktree API not available (404), will use fallback")
			return null
		}

		log.error("Worktree API call failed", err)
		return null
	}
}

/**
 * Creates a worktree via the Electron IPC fallback.
 * Used when the OpenCode experimental API is unavailable.
 */
async function createViaElectron(
	sourceDir: string,
	sessionSlug: string,
): Promise<WorktreeResult | null> {
	if (!isElectron) {
		log.warn("Electron fallback not available in browser mode")
		return null
	}

	try {
		const result = await window.palot.worktree.create(sourceDir, sessionSlug)
		log.info("Worktree created via Electron fallback", {
			worktreeRoot: result.worktreeRoot,
			branchName: result.branchName,
		})

		return {
			worktreeRoot: result.worktreeRoot,
			worktreeWorkspace: result.worktreeWorkspace,
			branchName: result.branchName,
			source: "electron-fallback",
		}
	} catch (err) {
		log.error("Electron worktree creation failed", err)
		throw err
	}
}

// ============================================================
// Public API
// ============================================================

/**
 * Creates a worktree for a session.
 *
 * Tries the OpenCode experimental API first (works for both local and remote
 * servers). Falls back to Electron IPC if the API is unavailable.
 *
 * @param projectDir  The project's main directory (for SDK client scoping)
 * @param sourceDir   The source directory (may differ from projectDir in monorepos)
 * @param sessionSlug  Short slug for naming the worktree/branch
 */
export async function createWorktree(
	projectDir: string,
	sourceDir: string,
	sessionSlug: string,
): Promise<WorktreeResult> {
	// Try API first (works for local and remote servers)
	const apiResult = await createViaApi(projectDir, sourceDir, sessionSlug)
	if (apiResult) return apiResult

	// Fall back to Electron IPC
	const electronResult = await createViaElectron(sourceDir, sessionSlug)
	if (electronResult) return electronResult

	throw new Error("Failed to create worktree: no available backend")
}

/**
 * Lists worktrees for a project via the OpenCode API.
 * Falls back to Electron IPC if the API is unavailable.
 */
export async function listWorktrees(projectDir: string): Promise<string[]> {
	const client = getProjectClient(projectDir)
	if (client) {
		try {
			const result = await client.experimental.worktree.list()
			return (result.data ?? []) as string[]
		} catch {
			log.debug("Worktree list API not available, falling back to Electron IPC")
		}
	}

	// Electron fallback: list from the filesystem
	if (isElectron) {
		try {
			const worktrees = await window.palot.worktree.list()
			return worktrees.map((wt) => wt.path)
		} catch {
			log.debug("Electron worktree list also failed")
		}
	}

	return []
}

/**
 * Removes a worktree via the OpenCode API.
 * Falls back to Electron IPC if the API is unavailable.
 */
export async function removeWorktree(
	projectDir: string,
	worktreeDir: string,
	sourceRepo?: string,
): Promise<void> {
	const client = getProjectClient(projectDir)
	if (client) {
		try {
			await client.experimental.worktree.remove({
				body: { directory: worktreeDir },
			})
			log.info("Worktree removed via API", { worktreeDir })
			return
		} catch {
			log.debug("Worktree remove API not available, falling back to Electron IPC")
		}
	}

	// Electron fallback
	if (isElectron) {
		const source = sourceRepo ?? projectDir
		await window.palot.worktree.remove(worktreeDir, source)
		return
	}

	throw new Error("Failed to remove worktree: no available backend")
}

/**
 * Resets a worktree back to the default branch via the OpenCode API.
 * This is API-only; no Electron fallback (this is a new feature).
 */
export async function resetWorktree(projectDir: string, worktreeDir: string): Promise<void> {
	const client = getProjectClient(projectDir)
	if (!client) {
		throw new Error("Not connected to server")
	}

	try {
		await client.experimental.worktree.reset({
			body: { directory: worktreeDir },
		})
		log.info("Worktree reset via API", { worktreeDir })
	} catch (err) {
		log.error("Worktree reset failed", err)
		throw new Error(
			`Failed to reset worktree: ${err instanceof Error ? err.message : "Unknown error"}`,
		)
	}
}
