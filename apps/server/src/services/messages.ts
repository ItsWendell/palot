import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

// ============================================================
// Types — mirrors OpenCode's message/part storage format
// ============================================================

interface StoredMessage {
	id: string
	sessionID: string
	role: "user" | "assistant"
	time: {
		created: number
		completed?: number
	}
	parentID?: string
	modelID?: string
	providerID?: string
	mode?: string
	agent?: string
	cost?: number
	tokens?: {
		input: number
		output: number
		reasoning: number
		cache: { read: number; write: number }
	}
	finish?: string
	summary?: {
		title?: string
		body?: string
		diffs?: unknown[]
	}
	[key: string]: unknown
}

interface StoredPart {
	id: string
	sessionID: string
	messageID: string
	type: string
	text?: string
	tool?: string
	callID?: string
	state?: {
		status?: string
		input?: Record<string, unknown>
		output?: string
		title?: string
		error?: string
		metadata?: Record<string, unknown>
		time?: { start?: number; end?: number }
	}
	time?: { start?: number; end?: number }
	[key: string]: unknown
}

export interface MessageEntry {
	info: StoredMessage
	parts: StoredPart[]
}

// ============================================================
// Paths
// ============================================================

function getStoragePath(): string {
	return join(homedir(), ".local", "share", "opencode", "storage")
}

// ============================================================
// Message reading functions
// ============================================================

/**
 * Reads all messages for a session from disk, then reads their parts.
 * Returns the same { info, parts }[] format as the OpenCode SDK API.
 *
 * Messages are sorted by creation time (ascending).
 */
export async function readSessionMessages(sessionId: string): Promise<MessageEntry[]> {
	const storagePath = getStoragePath()
	const messageDir = join(storagePath, "message", sessionId)
	const partDir = join(storagePath, "part")

	// 1. Read all message JSON files for this session
	let messageFiles: string[]
	try {
		const files = await readdir(messageDir)
		messageFiles = files.filter((f) => f.endsWith(".json"))
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return [] // No messages directory — session has no messages
		}
		throw err
	}

	if (messageFiles.length === 0) return []

	// 2. Read all messages in parallel
	const messageResults = await Promise.allSettled(
		messageFiles.map(async (file) => {
			const filePath = join(messageDir, file)
			return Bun.file(filePath).json() as Promise<StoredMessage>
		}),
	)

	const messages: StoredMessage[] = []
	for (const result of messageResults) {
		if (result.status === "fulfilled" && result.value.id) {
			messages.push(result.value)
		}
	}

	// Sort messages by creation time
	messages.sort((a, b) => (a.time.created ?? 0) - (b.time.created ?? 0))

	// 3. Read parts for all messages in parallel
	const entries: MessageEntry[] = await Promise.all(
		messages.map(async (msg) => {
			const msgPartDir = join(partDir, msg.id)
			const parts: StoredPart[] = []

			try {
				const partFiles = await readdir(msgPartDir)
				const jsonFiles = partFiles.filter((f) => f.endsWith(".json"))

				const partResults = await Promise.allSettled(
					jsonFiles.map(async (file) => {
						const filePath = join(msgPartDir, file)
						return Bun.file(filePath).json() as Promise<StoredPart>
					}),
				)

				for (const result of partResults) {
					if (result.status === "fulfilled" && result.value.id) {
						parts.push(result.value)
					}
				}

				// Sort parts by time (step-start first, then by start time)
				parts.sort((a, b) => {
					const timeA = a.time?.start ?? a.state?.time?.start ?? 0
					const timeB = b.time?.start ?? b.state?.time?.start ?? 0
					return timeA - timeB
				})
			} catch (err) {
				// No parts directory — message might be user-only
				if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
					console.error(`Failed to read parts for message ${msg.id}:`, err)
				}
			}

			return { info: msg, parts }
		}),
	)

	return entries
}
