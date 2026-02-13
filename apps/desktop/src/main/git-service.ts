import path from "node:path"
import type { BranchSummary, StatusResult } from "simple-git"
import simpleGit from "simple-git"

/**
 * Git service for the Electron main process.
 *
 * Provides branch listing, status checks, checkout, stash, and worktree
 * operations via simple-git. Each call creates a fresh git instance scoped
 * to the given directory to avoid state leaks between projects.
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

// ============================================================
// Commit, push, and diff operations (for worktree handoff)
// ============================================================

export interface GitDiffStat {
	filesChanged: number
	insertions: number
	deletions: number
	files: { path: string; insertions: number; deletions: number }[]
}

export interface GitCommitResult {
	success: boolean
	commitHash?: string
	error?: string
}

export interface GitPushResult {
	success: boolean
	error?: string
}

/**
 * Gets a summary of uncommitted changes (staged + unstaged) in a directory.
 */
export async function getDiffStat(directory: string): Promise<GitDiffStat> {
	const git = getGit(directory)
	const status: StatusResult = await git.status()
	const files: GitDiffStat["files"] = []

	// Combine all changed files
	const allFiles = new Set([
		...status.modified,
		...status.created,
		...status.deleted,
		...status.renamed.map((r) => r.to),
		...status.not_added,
	])

	for (const f of allFiles) {
		files.push({ path: f, insertions: 0, deletions: 0 })
	}

	return {
		filesChanged: allFiles.size,
		insertions: 0,
		deletions: 0,
		files,
	}
}

/**
 * Commits all changes (staged + unstaged) with the given message.
 * Adds all tracked and untracked files before committing.
 */
export async function commitAll(directory: string, message: string): Promise<GitCommitResult> {
	const git = getGit(directory)
	try {
		await git.add("-A")
		const result = await git.commit(message)
		return { success: true, commitHash: result.commit }
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : "Commit failed",
		}
	}
}

/**
 * Pushes the current branch to the remote. Sets upstream if needed.
 */
export async function push(directory: string, remote = "origin"): Promise<GitPushResult> {
	const git = getGit(directory)
	try {
		const branch = (await git.raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim()
		await git.push(remote, branch, ["--set-upstream"])
		return { success: true }
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : "Push failed",
		}
	}
}

/**
 * Creates a branch on the given directory (worktree) from the current HEAD.
 * If the worktree is in detached HEAD, this creates a new branch pointing at HEAD.
 */
export async function createBranch(
	directory: string,
	branchName: string,
): Promise<GitCheckoutResult> {
	const git = getGit(directory)
	try {
		await git.checkout(["-b", branchName])
		return { success: true }
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : "Branch creation failed",
		}
	}
}

/**
 * Applies uncommitted changes from a source directory (worktree) to a target directory
 * (local checkout) as a patch. This lets users "cherry-pick" worktree changes into
 * their working copy without any branch/commit requirements.
 *
 * Returns the list of files that were patched.
 */
export async function applyChangesToLocal(
	worktreeDir: string,
	localDir: string,
): Promise<{ success: boolean; filesApplied: string[]; error?: string }> {
	const worktreeGit = getGit(worktreeDir)
	try {
		// Generate a diff of all uncommitted changes in the worktree
		// First, add everything to get a complete picture
		await worktreeGit.add("-A")
		const diff = await worktreeGit.diff(["--cached"])

		if (!diff.trim()) {
			return { success: true, filesApplied: [], error: "No changes to apply" }
		}

		// Write diff to a temp file, then apply it to the local directory
		const os = await import("node:os")
		const fs = await import("node:fs/promises")
		const tmpFile = path.join(os.tmpdir(), `palot-patch-${Date.now()}.patch`)
		await fs.writeFile(tmpFile, diff)

		const localGit = getGit(localDir)
		try {
			try {
				await localGit.raw(["apply", "--3way", tmpFile])
			} catch {
				// --3way failed, try without it
				await localGit.raw(["apply", tmpFile])
			}
		} finally {
			await fs.unlink(tmpFile).catch(() => {})
		}

		// Get list of files that changed
		const status = await localGit.status()
		const filesApplied = [...status.modified, ...status.created, ...status.not_added]

		// Reset the worktree staging (we added everything just for the diff)
		await worktreeGit.reset(["HEAD"])

		return { success: true, filesApplied }
	} catch (err) {
		// Reset staging on failure too
		try {
			await worktreeGit.reset(["HEAD"])
		} catch {
			// Best effort
		}
		return {
			success: false,
			filesApplied: [],
			error: err instanceof Error ? err.message : "Failed to apply changes",
		}
	}
}

/**
 * Gets the remote URL for a repository (defaults to "origin").
 * Returns null if no remote is configured.
 */
export async function getRemoteUrl(directory: string, remote = "origin"): Promise<string | null> {
	const git = getGit(directory)
	try {
		const url = await git.raw(["remote", "get-url", remote])
		return url.trim() || null
	} catch {
		return null
	}
}

// ============================================================
// Worktree operations
// ============================================================

export interface WorktreeEntry {
	/** Absolute path to the worktree directory */
	path: string
	/** HEAD commit hash */
	head: string
	/** Branch name (empty string if detached) */
	branch: string
	/** Whether this is a bare repository worktree */
	bare: boolean
}

export interface WorktreeAddResult {
	success: boolean
	/** Absolute path to the created worktree */
	worktreePath?: string
	/** Branch name created or checked out */
	branchName?: string
	error?: string
}

export interface WorktreeRemoveResult {
	success: boolean
	error?: string
}

/**
 * Adds a git worktree. Creates a new branch if `newBranch` is provided,
 * otherwise checks out an existing ref.
 */
export async function addWorktree(
	repoDir: string,
	worktreePath: string,
	options: { newBranch?: string; ref?: string } = {},
): Promise<WorktreeAddResult> {
	const git = getGit(repoDir)
	try {
		const args = ["worktree", "add"]
		if (options.newBranch) {
			args.push("-b", options.newBranch)
		}
		args.push(worktreePath)
		if (options.ref) {
			args.push(options.ref)
		}
		await git.raw(args)
		return {
			success: true,
			worktreePath: path.resolve(repoDir, worktreePath),
			branchName: options.newBranch ?? options.ref ?? "",
		}
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : "Failed to add worktree",
		}
	}
}

/**
 * Removes a git worktree. Optionally forces removal even with uncommitted changes.
 */
export async function removeWorktree(
	repoDir: string,
	worktreePath: string,
	force = false,
): Promise<WorktreeRemoveResult> {
	const git = getGit(repoDir)
	try {
		const args = ["worktree", "remove"]
		if (force) args.push("--force")
		args.push(worktreePath)
		await git.raw(args)
		return { success: true }
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : "Failed to remove worktree",
		}
	}
}

/**
 * Lists all worktrees for a repository by parsing `git worktree list --porcelain`.
 */
export async function listWorktrees(repoDir: string): Promise<WorktreeEntry[]> {
	const git = getGit(repoDir)
	const raw = await git.raw(["worktree", "list", "--porcelain"])
	const entries: WorktreeEntry[] = []
	let current: Partial<WorktreeEntry> = {}

	for (const line of raw.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (current.path) entries.push(current as WorktreeEntry)
			current = { path: line.slice("worktree ".length), head: "", branch: "", bare: false }
		} else if (line.startsWith("HEAD ")) {
			current.head = line.slice("HEAD ".length)
		} else if (line.startsWith("branch ")) {
			// branch refs/heads/main -> main
			current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "")
		} else if (line === "bare") {
			current.bare = true
		} else if (line === "detached") {
			current.branch = ""
		} else if (line === "" && current.path) {
			entries.push(current as WorktreeEntry)
			current = {}
		}
	}

	// Push final entry if exists
	if (current.path) entries.push(current as WorktreeEntry)

	return entries
}

/**
 * Gets the git repository root for a directory.
 * Works from subdirectories and existing worktrees.
 */
export async function getGitRoot(directory: string): Promise<string | null> {
	const git = getGit(directory)
	try {
		const root = await git.raw(["rev-parse", "--show-toplevel"])
		return root.trim()
	} catch {
		return null
	}
}

/**
 * Resolves the default remote branch.
 * Checks origin/HEAD first, falls back to origin/main, origin/master, then HEAD.
 */
export async function getDefaultBranch(repoDir: string): Promise<string> {
	const git = getGit(repoDir)
	try {
		// Try origin/HEAD -> origin/main symbolic ref
		const symbolic = await git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"]).catch(() => null)
		if (symbolic) {
			return symbolic.trim().replace(/^refs\/remotes\/origin\//, "")
		}
	} catch {
		// Fall through
	}

	try {
		// Check if origin/main exists
		await git.raw(["rev-parse", "--verify", "origin/main"])
		return "main"
	} catch {
		// Fall through
	}

	try {
		// Check if origin/master exists
		await git.raw(["rev-parse", "--verify", "origin/master"])
		return "master"
	} catch {
		// Fall through
	}

	// Final fallback: current branch
	try {
		const branch = await git.raw(["rev-parse", "--abbrev-ref", "HEAD"])
		return branch.trim()
	} catch {
		return "main"
	}
}

/**
 * Copies gitignored environment files (.env*) from source to target directory.
 * Skips .env*.example files. Uses fs to read and write.
 */
export async function copyGitIgnoredFiles(
	sourceDir: string,
	targetDir: string,
	patterns: string[] = [".env*"],
): Promise<{ copied: string[]; errors: string[] }> {
	const fs = await import("node:fs/promises")
	const copied: string[] = []
	const errors: string[] = []

	for (const pattern of patterns) {
		try {
			const entries = await fs.readdir(sourceDir)
			const globBase = pattern.replace("*", "")
			const matching = entries.filter(
				(e) => e.startsWith(globBase) && !e.endsWith(".example") && !e.endsWith(".sample"),
			)

			for (const filename of matching) {
				try {
					const src = path.join(sourceDir, filename)
					const dest = path.join(targetDir, filename)
					const stat = await fs.stat(src)
					if (stat.isFile()) {
						await fs.copyFile(src, dest)
						copied.push(filename)
					}
				} catch (err) {
					errors.push(`${filename}: ${err instanceof Error ? err.message : "copy failed"}`)
				}
			}
		} catch (err) {
			errors.push(`${pattern}: ${err instanceof Error ? err.message : "readdir failed"}`)
		}
	}

	return { copied, errors }
}
