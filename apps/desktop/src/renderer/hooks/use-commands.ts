import { useCallback, useMemo } from "react"
import type { Session, TextPart } from "../lib/types"
import { getProjectClient } from "../services/connection-manager"
import { useAppStore } from "../stores/app-store"
import { useServerCommands } from "./use-opencode-data"

// ============================================================
// Types
// ============================================================

export interface AppCommand {
	/** Unique command name (used as slash command: /undo, /redo, etc.) */
	name: string
	/** Human-readable label for UI display */
	label: string
	/** Short description */
	description: string
	/** Whether this command is currently available */
	enabled: boolean
	/** Keyboard shortcut label for display (e.g. "⌘Z") */
	shortcut?: string
	/** Execute the command */
	execute: () => Promise<void>
	/** Source: client-side or server-side */
	source: "client" | "server"
}

export interface ServerCommand {
	name: string
	description?: string
	agent?: string
}

// ============================================================
// useSessionRevert — undo/redo logic for a session
// ============================================================

/**
 * Returns the last user message ID from a session's messages in the store,
 * optionally before a given revert point.
 */
function findUndoTarget(sessionId: string, revertMessageId?: string): string | null {
	const messages = useAppStore.getState().messages[sessionId]
	if (!messages || messages.length === 0) return null

	// Find the last user message before the revert point (or absolute last if no revert)
	let lastUserMsgId: string | null = null
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role !== "user") continue
		// If there's a revert point, find the last user message BEFORE it
		if (revertMessageId && msg.id >= revertMessageId) continue
		lastUserMsgId = msg.id
		break
	}
	return lastUserMsgId
}

/**
 * For redo: find the next user message after the current revert point.
 */
function findRedoTarget(sessionId: string, revertMessageId: string): string | null {
	const messages = useAppStore.getState().messages[sessionId]
	if (!messages) return null

	let foundRevertPoint = false
	for (const msg of messages) {
		if (msg.id === revertMessageId) {
			foundRevertPoint = true
			continue
		}
		if (foundRevertPoint && msg.role === "user") {
			return msg.id
		}
	}
	return null
}

/**
 * Gets the text content from a user message's parts (for restoring to prompt input after undo).
 */
function getUserMessageText(messageId: string): string {
	const parts = useAppStore.getState().parts[messageId]
	if (!parts) return ""
	return parts
		.filter((p): p is TextPart => p.type === "text" && !("synthetic" in p && p.synthetic))
		.map((p) => p.text)
		.join("\n")
}

export interface UseSessionRevertResult {
	/** Whether the session is currently in a reverted state */
	isReverted: boolean
	/** The revert info from the session, if any */
	revertInfo: Session["revert"] | undefined
	/** Whether undo is available */
	canUndo: boolean
	/** Whether redo is available */
	canRedo: boolean
	/** Undo the last turn. Returns the user message text that was undone (for restoring to input). */
	undo: () => Promise<string | undefined>
	/** Redo — restore previously reverted messages */
	redo: () => Promise<void>
	/** Revert to a specific user message by ID (for per-turn undo buttons). */
	revertToMessage: (messageId: string) => Promise<void>
}

/**
 * Hook for undo/redo on a specific session.
 * Mirrors the TUI's undo/redo behavior from session/index.tsx.
 */
export function useSessionRevert(
	directory: string | null,
	sessionId: string | null,
): UseSessionRevertResult {
	const session = useAppStore((s) => (sessionId ? s.sessions[sessionId]?.session : undefined))
	const messages = useAppStore((s) => (sessionId ? s.messages[sessionId] : undefined))

	const isReverted = !!session?.revert
	const revertInfo = session?.revert

	// Can undo if: connected, session exists, has user messages, not already fully reverted to start
	const canUndo = useMemo(() => {
		if (!directory || !sessionId || !messages || messages.length === 0) return false
		// Find a user message to revert to
		const target = findUndoTarget(sessionId, revertInfo?.messageID)
		return target !== null
	}, [directory, sessionId, messages, revertInfo])

	// Can redo if: session is in a reverted state
	const canRedo = isReverted

	const undo = useCallback(async (): Promise<string | undefined> => {
		if (!directory || !sessionId) return undefined
		const client = getProjectClient(directory)
		if (!client) return undefined

		// If busy, abort first
		const entry = useAppStore.getState().sessions[sessionId]
		if (entry?.status?.type === "busy") {
			await client.session.abort({ sessionID: sessionId })
		}

		// Find the undo target
		const targetId = findUndoTarget(sessionId, revertInfo?.messageID)
		if (!targetId) return undefined

		// Get the user's text before reverting (to restore to prompt)
		const userText = getUserMessageText(targetId)

		await client.session.revert({ sessionID: sessionId, messageID: targetId })

		return userText
	}, [directory, sessionId, revertInfo])

	const redo = useCallback(async () => {
		if (!directory || !sessionId || !revertInfo) return
		const client = getProjectClient(directory)
		if (!client) return

		// TUI logic: if there's a next user message after revert point, move revert forward.
		// Otherwise, fully unrevert.
		const nextTarget = findRedoTarget(sessionId, revertInfo.messageID)
		if (nextTarget) {
			await client.session.revert({ sessionID: sessionId, messageID: nextTarget })
		} else {
			await client.session.unrevert({ sessionID: sessionId })
		}
	}, [directory, sessionId, revertInfo])

	const revertToMessage = useCallback(
		async (messageId: string) => {
			if (!directory || !sessionId) return
			const client = getProjectClient(directory)
			if (!client) return

			// If busy, abort first
			const entry = useAppStore.getState().sessions[sessionId]
			if (entry?.status?.type === "busy") {
				await client.session.abort({ sessionID: sessionId })
			}

			await client.session.revert({ sessionID: sessionId, messageID: messageId })
		},
		[directory, sessionId],
	)

	return { isReverted, revertInfo, canUndo, canRedo, undo, redo, revertToMessage }
}

// ============================================================
// useCommands — unified command registry
// ============================================================

/**
 * Builds the full list of available commands for a session,
 * including both client-side actions and server-side commands.
 */
export function useCommands(
	directory: string | null,
	sessionId: string | null,
	options?: {
		onUndoTextRestore?: (text: string) => void
	},
): AppCommand[] {
	const { canUndo, canRedo, undo, redo } = useSessionRevert(directory, sessionId)
	const serverCommands = useServerCommands(directory)
	const sessionStatus = useAppStore((s) => (sessionId ? s.sessions[sessionId]?.status : undefined))
	const isIdle = sessionStatus?.type === "idle" || !sessionStatus

	// Client-side commands
	const clientCommands = useMemo<AppCommand[]>(() => {
		const cmds: AppCommand[] = []

		cmds.push({
			name: "undo",
			label: "Undo",
			description: "Undo the last turn and restore file changes",
			enabled: canUndo,
			shortcut: "⌘Z",
			source: "client",
			execute: async () => {
				const text = await undo()
				if (text && options?.onUndoTextRestore) {
					options.onUndoTextRestore(text)
				}
			},
		})

		cmds.push({
			name: "redo",
			label: "Redo",
			description: "Restore previously undone messages",
			enabled: canRedo,
			shortcut: "⇧⌘Z",
			source: "client",
			execute: async () => {
				await redo()
			},
		})

		cmds.push({
			name: "compact",
			label: "Compact",
			description: "Summarize the conversation to save context",
			enabled: !!directory && !!sessionId && isIdle,
			source: "client",
			execute: async () => {
				if (!directory || !sessionId) return
				const client = getProjectClient(directory)
				if (!client) return
				await client.session.summarize({ sessionID: sessionId })
			},
		})

		return cmds
	}, [canUndo, canRedo, undo, redo, directory, sessionId, isIdle, options?.onUndoTextRestore])

	// Server-side commands merged in
	const allCommands = useMemo<AppCommand[]>(() => {
		const serverCmds: AppCommand[] = serverCommands.map((cmd) => ({
			name: cmd.name,
			label: cmd.name.charAt(0).toUpperCase() + cmd.name.slice(1),
			description: cmd.description ?? `Run /${cmd.name}`,
			enabled: !!directory && !!sessionId && isIdle,
			source: "server" as const,
			execute: async () => {
				if (!directory || !sessionId) return
				const client = getProjectClient(directory)
				if (!client) return
				await client.session.command({
					sessionID: sessionId,
					command: cmd.name,
					arguments: "",
				})
			},
		}))
		return [...clientCommands, ...serverCmds]
	}, [clientCommands, serverCommands, directory, sessionId, isIdle])

	return allCommands
}
