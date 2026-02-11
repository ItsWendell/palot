/**
 * Filesystem utilities with safe error handling.
 */
import { lstat, readdir, readlink, realpath, stat } from "node:fs/promises"
import { join } from "node:path"

/**
 * Check if a file or directory exists.
 */
export async function exists(path: string): Promise<boolean> {
	try {
		await stat(path)
		return true
	} catch {
		return false
	}
}

/**
 * Safely read a file, returning undefined if it doesn't exist.
 */
export async function safeReadFile(path: string): Promise<string | undefined> {
	try {
		return await Bun.file(path).text()
	} catch {
		return undefined
	}
}

/**
 * Safely read and parse a JSON file.
 */
export async function safeReadJson<T = unknown>(path: string): Promise<T | undefined> {
	const content = await safeReadFile(path)
	if (content === undefined) return undefined
	try {
		return JSON.parse(content) as T
	} catch {
		return undefined
	}
}

/**
 * List files in a directory, returning empty array if dir doesn't exist.
 */
export async function safeReadDir(path: string): Promise<string[]> {
	try {
		return await readdir(path)
	} catch {
		return []
	}
}

/**
 * List files matching a pattern in a directory.
 */
export async function globDir(dir: string, pattern: string): Promise<string[]> {
	const glob = new Bun.Glob(pattern)
	const matches: string[] = []
	for await (const match of glob.scan({ cwd: dir, absolute: false })) {
		matches.push(join(dir, match))
	}
	return matches
}

/**
 * Check if a path is a symlink and get its target.
 * Uses lstat (not stat) because stat follows symlinks and would never report isSymbolicLink.
 */
export async function getSymlinkInfo(
	path: string,
): Promise<{ isSymlink: boolean; target?: string }> {
	try {
		const lstats = await lstat(path)
		if (lstats.isSymbolicLink()) {
			const target = await readlink(path)
			return { isSymlink: true, target }
		}
		return { isSymlink: false }
	} catch {
		return { isSymlink: false }
	}
}

/**
 * Resolve a path to its real absolute path (following symlinks, normalizing case on macOS).
 * Returns the input path unchanged if resolution fails (e.g. file doesn't exist).
 */
export async function resolveRealPath(path: string): Promise<string> {
	try {
		return await realpath(path)
	} catch {
		return path
	}
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export async function ensureDir(path: string): Promise<void> {
	const { mkdir } = await import("node:fs/promises")
	await mkdir(path, { recursive: true })
}

/**
 * Write a file, creating parent directories as needed.
 */
export async function writeFileSafe(path: string, content: string): Promise<void> {
	const { dirname } = await import("node:path")
	await ensureDir(dirname(path))
	await Bun.write(path, content)
}

/**
 * Read JSONL file (one JSON object per line), returning array of parsed objects.
 */
export async function readJsonl<T = unknown>(path: string): Promise<T[]> {
	const content = await safeReadFile(path)
	if (!content) return []

	const results: T[] = []
	for (const line of content.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed) continue
		try {
			results.push(JSON.parse(trimmed) as T)
		} catch {
			// Skip malformed lines
		}
	}
	return results
}
