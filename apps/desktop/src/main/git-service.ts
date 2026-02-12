import type { BranchSummary, StatusResult } from "simple-git"
import simpleGit from "simple-git"

/**
 * Git service for the Electron main process.
 *
 * Provides branch listing, status checks, checkout, and stash operations
 * via simple-git. Each call creates a fresh git instance scoped to the
 * given directory to avoid state leaks between projects.
 */

function getGit(directory: string) {
	return simpleGit({ baseDir: directory, trimmed: true })
}

// ============================================================
// Types exposed to the renderer via IPC
// ============================================================

export interface GitBranchInfo {
	/** Current branch name (empty string if detached HEAD) */
	current: string
	/** Whether HEAD is detached */
	detached: boolean
	/** Local branch names */
	local: string[]
	/** Remote branch names (e.g. "origin/main") */
	remote: string[]
}

export interface GitStatusInfo {
	/** Whether the working tree is clean (no staged, unstaged, or untracked changes) */
	isClean: boolean
	/** Number of staged files */
	staged: number
	/** Number of modified (unstaged) files */
	modified: number
	/** Number of untracked files */
	untracked: number
	/** Number of files with merge conflicts */
	conflicted: number
	/** Human-readable summary of dirty state */
	summary: string
}

export interface GitCheckoutResult {
	success: boolean
	error?: string
}

export interface GitStashResult {
	success: boolean
	stashed: boolean
	error?: string
}

// ============================================================
// Service functions (called from IPC handlers)
// ============================================================

/**
 * Lists all local and remote branches for a directory.
 */
export async function listBranches(directory: string): Promise<GitBranchInfo> {
	const git = getGit(directory)
	const summary: BranchSummary = await git.branch(["-a"])

	const local: string[] = []
	const remote: string[] = []

	for (const [name] of Object.entries(summary.branches)) {
		// simple-git prefixes remote branches with "remotes/"
		if (name.startsWith("remotes/")) {
			// Strip "remotes/" prefix for cleaner display
			const cleanName = name.replace(/^remotes\//, "")
			// Skip HEAD pointer (e.g. "origin/HEAD -> origin/main")
			if (cleanName.endsWith("/HEAD")) continue
			remote.push(cleanName)
		} else {
			local.push(name)
		}
	}

	return {
		current: summary.current,
		detached: summary.detached,
		local,
		remote,
	}
}

/**
 * Gets the working tree status for a directory.
 */
export async function getStatus(directory: string): Promise<GitStatusInfo> {
	const git = getGit(directory)
	const status: StatusResult = await git.status()

	const staged = status.staged.length
	const modified = status.modified.length + status.deleted.length + status.renamed.length
	const untracked = status.not_added.length
	const conflicted = status.conflicted.length
	const isClean = status.isClean()

	// Build a human-readable summary
	const parts: string[] = []
	if (staged > 0) parts.push(`${staged} staged`)
	if (modified > 0) parts.push(`${modified} modified`)
	if (untracked > 0) parts.push(`${untracked} untracked`)
	if (conflicted > 0) parts.push(`${conflicted} conflicted`)
	const summary = isClean ? "Working tree clean" : parts.join(", ")

	return { isClean, staged, modified, untracked, conflicted, summary }
}

/**
 * Checks out a branch. Fails if there are uncommitted changes
 * that would be overwritten (git's default behavior).
 */
export async function checkout(directory: string, branch: string): Promise<GitCheckoutResult> {
	const git = getGit(directory)
	try {
		// Check if the branch exists locally
		const branches = await git.branchLocal()
		if (branches.all.includes(branch)) {
			await git.checkout(branch)
		} else {
			// Try to check out a remote tracking branch
			// This creates a local branch tracking the remote one
			await git.checkout(["-b", branch, `origin/${branch}`])
		}
		return { success: true }
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : "Checkout failed",
		}
	}
}

/**
 * Stashes uncommitted changes, then checks out the target branch.
 * Returns whether changes were actually stashed (clean trees skip the stash).
 */
export async function stashAndCheckout(directory: string, branch: string): Promise<GitStashResult> {
	const git = getGit(directory)
	try {
		const status = await git.status()
		const needsStash = !status.isClean()

		if (needsStash) {
			await git.stash(["push", "-m", `palot: auto-stash before switching to ${branch}`])
		}

		// Now checkout
		const branches = await git.branchLocal()
		if (branches.all.includes(branch)) {
			await git.checkout(branch)
		} else {
			await git.checkout(["-b", branch, `origin/${branch}`])
		}

		return { success: true, stashed: needsStash }
	} catch (err) {
		return {
			success: false,
			stashed: false,
			error: err instanceof Error ? err.message : "Stash and checkout failed",
		}
	}
}

/**
 * Pops the most recent stash entry.
 */
export async function stashPop(directory: string): Promise<GitStashResult> {
	const git = getGit(directory)
	try {
		await git.stash(["pop"])
		return { success: true, stashed: false }
	} catch (err) {
		return {
			success: false,
			stashed: false,
			error: err instanceof Error ? err.message : "Stash pop failed",
		}
	}
}
