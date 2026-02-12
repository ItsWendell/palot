/**
 * Tests for history session writer with deduplication.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ConvertedSession } from "../../src/types/conversion-result"
import { writeHistorySessionsDetailed } from "../../src/writer/history"

// ============================================================
// Helpers
// ============================================================

function makeSession(overrides: { projectId?: string; sessionId?: string } = {}): ConvertedSession {
	const sessionId = overrides.sessionId ?? `ses_cursor_test${Date.now()}`
	const projectId = overrides.projectId ?? "proj_test_12345678"

	return {
		projectId,
		session: {
			id: sessionId,
			slug: "test-session",
			version: "imported",
			projectID: projectId,
			directory: "/tmp/test-project",
			title: "Test Session",
			time: { created: Date.now(), updated: Date.now() },
			summary: { additions: 0, deletions: 0, files: 0 },
		},
		messages: [
			{
				id: `msg_${sessionId}_0001`,
				sessionID: sessionId,
				role: "user",
				time: { created: Date.now(), updated: Date.now() },
				parts: [
					{
						id: `part_msg_${sessionId}_0001_001`,
						messageID: `msg_${sessionId}_0001`,
						type: "text",
						content: "Hello",
					},
				],
			},
		],
	}
}

function tempDir(): string {
	return join(tmpdir(), `palot-history-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

// ============================================================
// Tests
// ============================================================

describe("writeHistorySessionsDetailed", () => {
	const tempDirs: string[] = []

	afterEach(async () => {
		for (const dir of tempDirs) {
			try {
				await rm(dir, { recursive: true })
			} catch {}
		}
		tempDirs.length = 0
	})

	const createTestDir = async () => {
		const dir = tempDir()
		tempDirs.push(dir)
		await mkdir(dir, { recursive: true })
		return dir
	}

	test("writes sessions to storage directory", async () => {
		const storageDir = await createTestDir()

		const sessions = [makeSession({ projectId: "proj_abc", sessionId: "ses_cursor_001" })]
		const result = await writeHistorySessionsDetailed(sessions, { storageDir })

		expect(result.filesWritten.length).toBeGreaterThan(0)
		expect(result.duplicatesSkipped).toHaveLength(0)
		expect(result.totalProcessed).toBe(1)

		// Should have written project, session, message, and part files
		const projectFiles = result.filesWritten.filter((f) => f.includes("/project/"))
		const sessionFiles = result.filesWritten.filter((f) => f.includes("/session/"))
		const messageFiles = result.filesWritten.filter((f) => f.includes("/message/"))
		const partFiles = result.filesWritten.filter((f) => f.includes("/part/"))
		expect(projectFiles).toHaveLength(1)
		expect(sessionFiles).toHaveLength(1)
		expect(messageFiles).toHaveLength(1)
		expect(partFiles).toHaveLength(1)
	})

	test("skips duplicate sessions on second write", async () => {
		const storageDir = await createTestDir()

		const sessions = [makeSession({ projectId: "proj_abc", sessionId: "ses_cursor_dedup1" })]

		// First write
		const result1 = await writeHistorySessionsDetailed(sessions, { storageDir })
		expect(result1.filesWritten.length).toBeGreaterThan(0)
		expect(result1.duplicatesSkipped).toHaveLength(0)

		// Second write with same session ID
		const result2 = await writeHistorySessionsDetailed(sessions, { storageDir })
		expect(result2.filesWritten).toHaveLength(0)
		expect(result2.duplicatesSkipped).toHaveLength(1)
		expect(result2.duplicatesSkipped[0]).toBe("ses_cursor_dedup1")
		expect(result2.totalProcessed).toBe(1)
	})

	test("writes new sessions and skips existing ones", async () => {
		const storageDir = await createTestDir()

		const session1 = makeSession({ projectId: "proj_abc", sessionId: "ses_cursor_existing" })
		const session2 = makeSession({ projectId: "proj_abc", sessionId: "ses_cursor_new" })

		// Write first session
		await writeHistorySessionsDetailed([session1], { storageDir })

		// Write both sessions - first should be skipped, second should be written
		const result = await writeHistorySessionsDetailed([session1, session2], { storageDir })
		expect(result.duplicatesSkipped).toHaveLength(1)
		expect(result.duplicatesSkipped[0]).toBe("ses_cursor_existing")
		expect(result.filesWritten.length).toBeGreaterThan(0)
		expect(result.totalProcessed).toBe(2)
	})

	test("calls progress callback during write", async () => {
		const storageDir = await createTestDir()

		const sessions = [
			makeSession({ projectId: "proj_abc", sessionId: "ses_cursor_prog1" }),
			makeSession({ projectId: "proj_abc", sessionId: "ses_cursor_prog2" }),
		]

		const progressCalls: string[] = []
		await writeHistorySessionsDetailed(sessions, {
			storageDir,
			onProgress: (progress) => {
				progressCalls.push(progress.phase)
			},
		})

		expect(progressCalls).toContain("dedup-check")
		expect(progressCalls).toContain("writing")
		expect(progressCalls).toContain("complete")
	})

	test("does not recreate existing project files", async () => {
		const storageDir = await createTestDir()

		const sessions1 = [makeSession({ projectId: "proj_same", sessionId: "ses_cursor_p1" })]

		// First write creates project file
		const result1 = await writeHistorySessionsDetailed(sessions1, { storageDir })
		const projectFiles1 = result1.filesWritten.filter((f) => f.includes("/project/"))
		expect(projectFiles1).toHaveLength(1)

		// Second write with a NEW session but same project
		const sessions2 = [makeSession({ projectId: "proj_same", sessionId: "ses_cursor_p2" })]
		const result2 = await writeHistorySessionsDetailed(sessions2, { storageDir })
		const projectFiles2 = result2.filesWritten.filter((f) => f.includes("/project/"))
		expect(projectFiles2).toHaveLength(0) // Project file already exists
	})

	test("handles empty sessions array", async () => {
		const storageDir = await createTestDir()

		const result = await writeHistorySessionsDetailed([], { storageDir })
		expect(result.filesWritten).toHaveLength(0)
		expect(result.duplicatesSkipped).toHaveLength(0)
		expect(result.totalProcessed).toBe(0)
	})

	test("reports progress with dedup count", async () => {
		const storageDir = await createTestDir()

		// Pre-write one session
		await writeHistorySessionsDetailed(
			[makeSession({ projectId: "proj_abc", sessionId: "ses_existing" })],
			{ storageDir },
		)

		// Now write with one existing and one new
		const sessions = [
			makeSession({ projectId: "proj_abc", sessionId: "ses_existing" }),
			makeSession({ projectId: "proj_abc", sessionId: "ses_brand_new" }),
		]

		let lastProgress: { duplicatesSkipped: number; phase: string } | null = null
		await writeHistorySessionsDetailed(sessions, {
			storageDir,
			onProgress: (p) => {
				lastProgress = p
			},
		})

		expect(lastProgress).not.toBeNull()
		expect(lastProgress!.phase).toBe("complete")
		expect(lastProgress!.duplicatesSkipped).toBe(1)
	})
})
