/**
 * Worktree lifecycle manager for the Electron main process.
 *
 * Orchestrates worktree creation, removal, and listing for both
 * interactive sessions and automations. Worktrees are stored in
 * ~/.palot/worktrees/{shortId}/{project-name}/ and auto-create
 * a branch named `palot/{sessionSlug}`.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { app } from "electron"
import {
	addWorktree,
	copyGitIgnoredFiles,
	getDefaultBranch,
	getGitRoot,
	removeWorktree,
} from "./git-service"
import { createLogger } from "./logger"

const log = createLogger("worktree-manager")

// ============================================================
// Types
// ============================================================

export interface WorktreeCreateResult {
	/** Absolute path to the worktree root (the git worktree directory) */
	worktreeRoot: string
	/**
	 * Workspace path within the worktree, accounting for monorepo subdirectories.
	 * If the source was /repo/packages/app, this points to /worktree/packages/app.
	 */
	worktreeWorkspace: string
	/** The branch name that was created (e.g. "palot/fix-auth-bug") */
	branchName: string
	/** Files copied from the source (e.g. .env) */
	copiedFiles: string[]
}

export interface WorktreeInfo {
	/** Absolute path to the worktree */
	path: string
	/** Git branch name */
	branch: string
	/** Disk usage in bytes */
	diskUsageBytes: number
	/** Last modified time (ms since epoch) */
	lastModifiedAt: number
	/** Associated session or automation slug (from directory name) */
	slug: string
	/** The source repository root this worktree belongs to */
	sourceRepo: string
}

export interface ManagedWorktree extends WorktreeInfo {
	/** Project name (from directory structure) */
	projectName: string
}

// ============================================================
// Paths
// ============================================================

/** Base directory for all managed worktrees: ~/.palot/worktrees/ */
function getWorktreeBaseDir(): string {
	const home = app.getPath("home")
	return path.join(home, ".palot", "worktrees")
}

/**
 * Computes worktree paths for a session.
 * Handles monorepo subdirectories: if sourceDir is /repo/packages/app,
 * the worktree is created at the repo root level and the workspace path
 * points to the subdirectory within the worktree.
 */
export async function computeWorktreePaths(
	sourceDir: string,
	sessionSlug: string,
): Promise<{
	repoRoot: string
	worktreeRoot: string
	worktreeWorkspace: string
	branchName: string
	subPath: string
}> {
	const repoRoot = (await getGitRoot(sourceDir)) ?? sourceDir
	const subPath = path.relative(repoRoot, sourceDir)
	const projectName = path.basename(repoRoot)
	const shortId = sessionSlug.slice(0, 8).replace(/[^a-z0-9-]/gi, "")
	const branchName = `palot/${sessionSlug}`

	const worktreeRoot = path.join(getWorktreeBaseDir(), shortId, projectName)
	const worktreeWorkspace = subPath ? path.join(worktreeRoot, subPath) : worktreeRoot

	return { repoRoot, worktreeRoot, worktreeWorkspace, branchName, subPath }
}

// ============================================================
// Lifecycle operations
// ============================================================

/**
 * Creates a worktree for a session. Orchestrates:
 * 1. Compute paths
 * 2. git worktree add -b palot/{slug}
 * 3. Copy .env* files
 */
export async function createSessionWorktree(
	sourceDir: string,
	sessionSlug: string,
): Promise<WorktreeCreateResult> {
	log.info("Creating worktree", { sourceDir, sessionSlug })

	const { repoRoot, worktreeRoot, worktreeWorkspace, branchName } = await computeWorktreePaths(
		sourceDir,
		sessionSlug,
	)

	// Ensure parent directory exists
	await fs.mkdir(path.dirname(worktreeRoot), { recursive: true })

	// Get the default branch to base the new worktree on
	const defaultBranch = await getDefaultBranch(repoRoot)

	// Create the worktree
	const result = await addWorktree(repoRoot, worktreeRoot, {
		newBranch: branchName,
		ref: defaultBranch,
	})

	if (!result.success) {
		throw new Error(`Failed to create worktree: ${result.error}`)
	}

	log.info("Worktree created", { worktreeRoot, branchName })

	// Copy .env* files from the source directory
	const { copied, errors } = await copyGitIgnoredFiles(sourceDir, worktreeWorkspace)
	if (errors.length > 0) {
		log.warn("Some files failed to copy", { errors })
	}
	if (copied.length > 0) {
		log.info("Copied environment files", { copied })
	}

	return {
		worktreeRoot,
		worktreeWorkspace,
		branchName,
		copiedFiles: copied,
	}
}

/**
 * Removes a worktree and cleans up empty parent directories.
 */
export async function removeSessionWorktree(
	worktreeRoot: string,
	sourceDir: string,
): Promise<void> {
	log.info("Removing worktree", { worktreeRoot, sourceDir })

	const repoRoot = (await getGitRoot(sourceDir)) ?? sourceDir

	// Force-remove the worktree (handles uncommitted changes)
	const result = await removeWorktree(repoRoot, worktreeRoot, true)
	if (!result.success) {
		log.warn("git worktree remove failed, attempting manual cleanup", { error: result.error })
		// Try to remove the directory manually as fallback
		try {
			await fs.rm(worktreeRoot, { recursive: true, force: true })
		} catch (err) {
			log.error("Manual cleanup also failed", err)
		}
		// Also prune stale worktree references
		try {
			const { default: simpleGit } = await import("simple-git")
			const git = simpleGit({ baseDir: repoRoot, trimmed: true })
			await git.raw(["worktree", "prune"])
		} catch {
			// Best effort
		}
	}

	// Clean up empty parent directories under the worktree base
	try {
		const parent = path.dirname(worktreeRoot)
		const entries = await fs.readdir(parent)
		if (entries.length === 0) {
			await fs.rmdir(parent)
		}
	} catch {
		// Best effort
	}

	log.info("Worktree removed", { worktreeRoot })
}

/**
 * Gets information about a specific worktree.
 */
export async function getWorktreeInfo(worktreeRoot: string): Promise<WorktreeInfo | null> {
	try {
		const stat = await fs.stat(worktreeRoot)
		if (!stat.isDirectory()) return null

		const diskUsageBytes = await getDiskUsage(worktreeRoot)
		const slug = path.basename(path.dirname(worktreeRoot))

		// Try to get the branch from git
		let branch = ""
		try {
			const { default: simpleGit } = await import("simple-git")
			const git = simpleGit({ baseDir: worktreeRoot, trimmed: true })
			branch = (await git.raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim()
		} catch {
			// Worktree may be broken
		}

		// Determine source repo from git config
		let sourceRepo = ""
		try {
			const { default: simpleGit } = await import("simple-git")
			const git = simpleGit({ baseDir: worktreeRoot, trimmed: true })
			const gitDir = (await git.raw(["rev-parse", "--git-common-dir"])).trim()
			sourceRepo = path.dirname(gitDir)
		} catch {
			// Best effort
		}

		return {
			path: worktreeRoot,
			branch,
			diskUsageBytes,
			lastModifiedAt: stat.mtimeMs,
			slug,
			sourceRepo,
		}
	} catch {
		return null
	}
}

/**
 * Lists all managed worktrees by scanning ~/.palot/worktrees/.
 */
export async function listAllWorktrees(): Promise<ManagedWorktree[]> {
	const baseDir = getWorktreeBaseDir()
	const results: ManagedWorktree[] = []

	try {
		const slugDirs = await fs.readdir(baseDir)

		for (const slugDir of slugDirs) {
			const slugPath = path.join(baseDir, slugDir)
			try {
				const stat = await fs.stat(slugPath)
				if (!stat.isDirectory()) continue

				const projectDirs = await fs.readdir(slugPath)
				for (const projectDir of projectDirs) {
					const worktreeRoot = path.join(slugPath, projectDir)
					try {
						const wtStat = await fs.stat(worktreeRoot)
						if (!wtStat.isDirectory()) continue

						const info = await getWorktreeInfo(worktreeRoot)
						if (info) {
							results.push({
								...info,
								projectName: projectDir,
							})
						}
					} catch {
						// Skip broken entries
					}
				}
			} catch {
				// Skip broken entries
			}
		}
	} catch {
		// Base directory doesn't exist yet
	}

	return results
}

/**
 * Prunes worktrees older than maxAgeDays.
 * Returns the number of worktrees pruned.
 */
export async function pruneStaleWorktrees(maxAgeDays = 7): Promise<number> {
	log.info("Pruning stale worktrees", { maxAgeDays })
	const worktrees = await listAllWorktrees()
	const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
	let pruned = 0

	for (const wt of worktrees) {
		if (wt.lastModifiedAt < cutoff) {
			log.info("Pruning stale worktree", { path: wt.path, lastModified: wt.lastModifiedAt })
			try {
				if (wt.sourceRepo) {
					await removeSessionWorktree(wt.path, wt.sourceRepo)
				} else {
					// No source repo info, just remove the directory
					await fs.rm(wt.path, { recursive: true, force: true })
				}
				pruned++
			} catch (err) {
				log.error("Failed to prune worktree", { path: wt.path }, err)
			}
		}
	}

	log.info("Pruning complete", { pruned, total: worktrees.length })
	return pruned
}

// ============================================================
// Helpers
// ============================================================

/**
 * Calculates disk usage for a directory (approximation using top-level file sizes).
 * For accuracy on large worktrees, we only sum file sizes at the first two levels.
 */
async function getDiskUsage(dir: string): Promise<number> {
	let total = 0
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		for (const entry of entries) {
			if (entry.name === ".git") continue // Skip .git (it's a file pointing to the main repo)
			const fullPath = path.join(dir, entry.name)
			if (entry.isFile()) {
				const stat = await fs.stat(fullPath)
				total += stat.size
			} else if (entry.isDirectory()) {
				// One level deeper for a rough estimate
				try {
					const subEntries = await fs.readdir(fullPath, { withFileTypes: true })
					for (const sub of subEntries) {
						if (sub.isFile()) {
							const stat = await fs.stat(path.join(fullPath, sub.name))
							total += stat.size
						}
					}
				} catch {
					// Skip unreadable subdirectories
				}
			}
		}
	} catch {
		// Directory might not exist
	}
	return total
}
