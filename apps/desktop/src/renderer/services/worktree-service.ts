/**
 * Worktree service layer.
 *
 * Provides worktree lifecycle operations (create, list, remove, reset) via
 * the OpenCode experimental worktree API. Works for both local and remote
 * OpenCode servers without any upstream code changes.
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
}

/** Result from the remote apply-to-local operation */
export interface RemoteApplyResult {
	success: boolean
	message: string
	error?: string
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
	const normalizedRoot = repoRoot.replace(/\/+$/, "")
	const normalizedSource = sourceDir.replace(/\/+$/, "")

	if (normalizedSource === normalizedRoot) return ""

	if (normalizedSource.startsWith(`${normalizedRoot}/`)) {
		return normalizedSource.slice(normalizedRoot.length + 1)
	}

	return ""
}

/**
 * Wait for a worktree.ready event by polling the project's sandbox list.
 * Checks if the directory appears in the list, meaning the worktree has been
 * fully bootstrapped.
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

	log.warn("Worktree readiness check timed out, proceeding anyway", { directory, timeoutMs })
}

// ============================================================
// Public API
// ============================================================

/**
 * Creates a worktree for a session via the OpenCode experimental API.
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
	const client = getProjectClient(projectDir)
	if (!client) {
		throw new Error("Not connected to server")
	}

	try {
		const result = await client.experimental.worktree.create({
			body: {
				name: sessionSlug,
				startCommand: buildEnvSyncCommand(sourceDir, "$PWD"),
			},
		})

		const data = result.data as WorktreeCreateResult | undefined
		if (!data?.directory) {
			throw new Error("Worktree API returned unexpected response")
		}

		log.info("Worktree created via API", {
			name: data.name,
			branch: data.branch,
			directory: data.directory,
		})

		// Wait for the worktree to be fully bootstrapped
		await waitForWorktreeReady(client, data.directory)

		// Compute the workspace subpath for monorepo support
		const subPath = computeSubPath(projectDir, sourceDir)
		const worktreeWorkspace = subPath ? `${data.directory}/${subPath}` : data.directory

		return {
			worktreeRoot: data.directory,
			worktreeWorkspace,
			branchName: data.branch,
		}
	} catch (err) {
		log.error("Worktree creation failed", err)
		throw new Error(
			`Failed to create worktree: ${err instanceof Error ? err.message : "Unknown error"}`,
		)
	}
}

/**
 * Lists worktree directories for a project via the OpenCode API.
 */
export async function listWorktrees(projectDir: string): Promise<string[]> {
	const client = getProjectClient(projectDir)
	if (!client) {
		return []
	}

	try {
		const result = await client.experimental.worktree.list()
		return (result.data ?? []) as string[]
	} catch {
		log.debug("Worktree list API not available")
		return []
	}
}

/**
 * Removes a worktree via the OpenCode API.
 */
export async function removeWorktree(projectDir: string, worktreeDir: string): Promise<void> {
	const client = getProjectClient(projectDir)
	if (!client) {
		throw new Error("Not connected to server")
	}

	try {
		await client.experimental.worktree.remove({
			body: { directory: worktreeDir },
		})
		log.info("Worktree removed via API", { worktreeDir })
	} catch (err) {
		log.error("Worktree removal failed", err)
		throw new Error(
			`Failed to remove worktree: ${err instanceof Error ? err.message : "Unknown error"}`,
		)
	}
}

/**
 * Resets a worktree back to the default branch via the OpenCode API.
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

// ============================================================
// Remote apply-to-local (via session.diff API)
// ============================================================

/**
 * Fetches the diff from a remote worktree session via the OpenCode `session.diff` API,
 * then applies it to the local checkout using Electron IPC (`git apply`).
 *
 * This enables "apply to local" for worktrees running on remote servers, where
 * Palot cannot directly access the worktree filesystem.
 *
 * @param projectDir  The project directory (for SDK client scoping)
 * @param sessionId   The OpenCode session ID running in the remote worktree
 * @param localDir    The local directory to apply changes to
 */
export async function applyRemoteDiffToLocal(
	projectDir: string,
	sessionId: string,
	localDir: string,
): Promise<RemoteApplyResult> {
	const client = getProjectClient(projectDir)
	if (!client) {
		return { success: false, message: "", error: "Not connected to server" }
	}

	if (!isElectron) {
		return {
			success: false,
			message: "",
			error: "Local git access required (Electron only)",
		}
	}

	try {
		log.info("Fetching remote diff for apply-to-local", { sessionId })
		const result = await client.session.diff({ sessionID: sessionId })
		const diffs = result.data as unknown

		if (!diffs || (Array.isArray(diffs) && diffs.length === 0)) {
			return { success: true, message: "No changes to apply" }
		}

		// Build a unified diff string from the API response
		let diffText: string
		if (typeof diffs === "string") {
			diffText = diffs
		} else if (Array.isArray(diffs)) {
			diffText = diffs
				.map((d) => {
					if (typeof d === "string") return d
					if (typeof d === "object" && d !== null && "diff" in d) {
						return (d as { diff: string }).diff
					}
					return ""
				})
				.filter(Boolean)
				.join("\n")
		} else {
			return { success: false, message: "", error: "Unexpected diff response format" }
		}

		if (!diffText.trim()) {
			return { success: true, message: "No changes to apply" }
		}

		log.info("Remote diff fetched, applying locally", {
			diffLength: diffText.length,
			localDir,
		})

		const { gitApplyDiffText } = await import("./backend")
		const applyResult = await gitApplyDiffText(localDir, diffText)

		if (applyResult.success) {
			return {
				success: true,
				message: `Applied ${applyResult.filesApplied.length} file${applyResult.filesApplied.length !== 1 ? "s" : ""} to local`,
			}
		}

		return {
			success: false,
			message: "",
			error: applyResult.error ?? "Failed to apply diff",
		}
	} catch (err) {
		log.error("Remote apply-to-local failed", err)
		return {
			success: false,
			message: "",
			error: err instanceof Error ? err.message : "Failed to fetch or apply remote diff",
		}
	}
}
