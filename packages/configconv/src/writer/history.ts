/**
 * History session writer.
 *
 * Writes converted chat sessions (from any source: Claude Code, Cursor, etc.)
 * to the OpenCode storage format on disk.
 *
 * Features:
 *   - Deduplication: checks for existing sessions before writing, skips duplicates
 *   - Progress reporting: optional callback for UI feedback
 *   - Atomic project writes: project files are only created if they don't exist
 *
 * OpenCode storage layout:
 *   ~/.local/share/opencode/storage/
 *     project/<projectId>.json         - Project metadata
 *     session/<projectId>/<sessionId>.json - Session metadata
 *     message/<sessionId>/<messageId>.json - Message metadata
 *     part/<messageId>/<partId>.json       - Message parts (text, tools, reasoning)
 */

import { join } from "node:path"
import type { ConvertedSession } from "../types/conversion-result"
import { ensureDir, exists, safeReadDir, writeFileSafe } from "../utils/fs"
import { stringifyJson } from "../utils/json"
import * as paths from "../utils/paths"

// ============================================================
// Types
// ============================================================

export interface HistoryWriteResult {
	/** Files that were written to disk */
	filesWritten: string[]
	/** Session IDs that were skipped because they already exist */
	duplicatesSkipped: string[]
	/** Total sessions processed (written + skipped) */
	totalProcessed: number
}

export interface HistoryWriteProgress {
	/** Current phase */
	phase: "dedup-check" | "writing" | "complete"
	/** 1-based index of current session being processed */
	sessionIndex: number
	/** Total sessions to process */
	sessionCount: number
	/** Number of duplicates skipped so far */
	duplicatesSkipped: number
}

// ============================================================
// Public API
// ============================================================

export interface HistoryWriteOptions {
	/** Optional callback for progress reporting */
	onProgress?: (progress: HistoryWriteProgress) => void
	/** Override the storage directory (default: ~/.local/share/opencode/storage/) */
	storageDir?: string
}

/**
 * Write converted sessions to OpenCode storage with deduplication.
 *
 * Checks for existing sessions in the storage directory and skips duplicates.
 * Returns both files written and duplicates skipped.
 *
 * @param sessions - Converted sessions from any source
 * @param onProgressOrOptions - Optional callback or options object
 * @returns Array of file paths that were written
 */
export async function writeHistorySessions(
	sessions: ConvertedSession[],
	onProgressOrOptions?: ((progress: HistoryWriteProgress) => void) | HistoryWriteOptions,
): Promise<string[]> {
	const options =
		typeof onProgressOrOptions === "function"
			? { onProgress: onProgressOrOptions }
			: (onProgressOrOptions ?? {})
	const result = await writeHistorySessionsDetailed(sessions, options)
	return result.filesWritten
}

/**
 * Write converted sessions with detailed result including dedup information.
 */
export async function writeHistorySessionsDetailed(
	sessions: ConvertedSession[],
	options: HistoryWriteOptions = {},
): Promise<HistoryWriteResult> {
	const { onProgress, storageDir: storageDirOverride } = options
	const storageDir = storageDirOverride ?? paths.ocStorageDir()
	const filesWritten: string[] = []
	const duplicatesSkipped: string[] = []

	// ─── Deduplication: discover existing session IDs ─────────────
	onProgress?.({
		phase: "dedup-check",
		sessionIndex: 0,
		sessionCount: sessions.length,
		duplicatesSkipped: 0,
	})

	const existingSessionIds = await discoverExistingSessionIds(storageDir)

	// ─── Collect unique projects ──────────────────────────────────
	const projects = new Map<string, { id: string; directory: string }>()
	const sessionsToWrite: ConvertedSession[] = []

	for (const session of sessions) {
		if (existingSessionIds.has(session.session.id)) {
			duplicatesSkipped.push(session.session.id)
			continue
		}

		sessionsToWrite.push(session)
		if (!projects.has(session.projectId)) {
			projects.set(session.projectId, {
				id: session.projectId,
				directory: session.session.directory,
			})
		}
	}

	// ─── Write project files (skip if already exists) ────────────
	for (const [projectId, project] of projects) {
		const projectPath = join(storageDir, "project", `${projectId}.json`)
		if (await exists(projectPath)) continue

		const projectData = {
			id: projectId,
			worktree: project.directory,
			vcs: "git",
			sandboxes: [],
			time: {
				created: Date.now(),
				updated: Date.now(),
			},
		}
		await writeFileSafe(projectPath, stringifyJson(projectData))
		filesWritten.push(projectPath)
	}

	// ─── Write session, message, and part files ──────────────────
	let sessionIndex = 0
	for (const session of sessionsToWrite) {
		sessionIndex++

		onProgress?.({
			phase: "writing",
			sessionIndex,
			sessionCount: sessionsToWrite.length,
			duplicatesSkipped: duplicatesSkipped.length,
		})

		// Session file
		const sessionDir = join(storageDir, "session", session.projectId)
		await ensureDir(sessionDir)
		const sessionPath = join(sessionDir, `${session.session.id}.json`)
		await writeFileSafe(sessionPath, stringifyJson(session.session))
		filesWritten.push(sessionPath)

		// Message and part files
		for (const message of session.messages) {
			// Message file
			const messageDir = join(storageDir, "message", session.session.id)
			await ensureDir(messageDir)
			const messagePath = join(messageDir, `${message.id}.json`)

			const messageData = {
				id: message.id,
				sessionID: message.sessionID,
				role: message.role,
				time: message.time,
			}
			await writeFileSafe(messagePath, stringifyJson(messageData))
			filesWritten.push(messagePath)

			// Part files
			for (const part of message.parts) {
				const partDir = join(storageDir, "part", message.id)
				await ensureDir(partDir)
				const partPath = join(partDir, `${part.id}.json`)

				const partData = {
					id: part.id,
					type: part.type,
					text: part.content,
					synthetic: false,
					time: { start: 0, end: 0 },
					messageID: part.messageID,
					sessionID: message.sessionID,
				}
				await writeFileSafe(partPath, stringifyJson(partData))
				filesWritten.push(partPath)
			}
		}
	}

	onProgress?.({
		phase: "complete",
		sessionIndex: sessionsToWrite.length,
		sessionCount: sessionsToWrite.length,
		duplicatesSkipped: duplicatesSkipped.length,
	})

	return {
		filesWritten,
		duplicatesSkipped,
		totalProcessed: sessions.length,
	}
}

// ============================================================
// Deduplication helpers
// ============================================================

/**
 * Discover all existing session IDs in the OpenCode storage directory.
 *
 * Scans all `storage/session/<projectId>/` directories and collects
 * session IDs from the filenames (e.g., `ses_cursor_abc12345.json`).
 */
async function discoverExistingSessionIds(storageDir: string): Promise<Set<string>> {
	const sessionBaseDir = join(storageDir, "session")
	const ids = new Set<string>()

	// List project directories under session/
	const projectDirs = await safeReadDir(sessionBaseDir)
	for (const projectDir of projectDirs) {
		const fullDir = join(sessionBaseDir, projectDir)
		const files = await safeReadDir(fullDir)
		for (const file of files) {
			if (file.endsWith(".json")) {
				ids.add(file.slice(0, -5)) // Remove .json extension
			}
		}
	}

	return ids
}
