import { useCallback } from "react"
import type {
	FileAttachment,
	FilePart,
	FilePartInput,
	QuestionAnswer,
	TextPart,
	UserMessage,
} from "../lib/types"
import { getProjectClient } from "../services/connection-manager"
import { useAppStore } from "../stores/app-store"

/**
 * Hook for OpenCode server connection state.
 * With the single-server architecture, this is much simpler.
 */
export function useServerConnection() {
	const opencode = useAppStore((s) => s.opencode ?? { url: null, connected: false })
	return {
		connected: opencode.connected,
		url: opencode.url,
	}
}

/**
 * Hook for agent actions (stop, approve, deny, etc.).
 * These operate on real OpenCode sessions via the SDK (v2).
 */
export function useAgentActions() {
	const abort = useCallback(async (directory: string, sessionId: string) => {
		const client = getProjectClient(directory)
		if (!client) throw new Error("Not connected to OpenCode server")
		await client.session.abort({ sessionID: sessionId })
	}, [])

	const sendPrompt = useCallback(
		async (
			directory: string,
			sessionId: string,
			text: string,
			options?: {
				model?: { providerID: string; modelID: string }
				agent?: string
				variant?: string
				files?: FileAttachment[]
			},
		) => {
			const client = getProjectClient(directory)
			if (!client) throw new Error("Not connected to OpenCode server")

			// Optimistic user message — appears immediately in the chat
			const optimisticId = `optimistic-${Date.now()}`
			const optimisticMessage: UserMessage = {
				id: optimisticId,
				sessionID: sessionId,
				role: "user",
				time: { created: Date.now() },
				agent: options?.agent ?? "build",
				model: options?.model ?? { providerID: "", modelID: "" },
			}
			const store = useAppStore.getState()
			store.upsertMessage(optimisticMessage)

			// Optimistic text part
			const optimisticTextPart: TextPart = {
				id: `${optimisticId}-text`,
				sessionID: sessionId,
				messageID: optimisticId,
				type: "text",
				text,
			}
			store.upsertPart(optimisticTextPart)

			// Optimistic file parts (so images show immediately in the chat)
			const files = options?.files ?? []
			for (let i = 0; i < files.length; i++) {
				const file = files[i]
				const optimisticFilePart: FilePart = {
					id: `${optimisticId}-file-${i}`,
					sessionID: sessionId,
					messageID: optimisticId,
					type: "file",
					mime: file.mediaType ?? "application/octet-stream",
					filename: file.filename,
					url: file.url,
				}
				store.upsertPart(optimisticFilePart)
			}

			// Build parts array for the API call
			const parts: Array<{ type: "text"; text: string } | FilePartInput> = [{ type: "text", text }]
			for (const file of files) {
				parts.push({
					type: "file",
					mime: file.mediaType ?? "application/octet-stream",
					filename: file.filename,
					url: file.url,
				})
			}

			await client.session.promptAsync({
				sessionID: sessionId,
				parts,
				model: options?.model
					? { providerID: options.model.providerID, modelID: options.model.modelID }
					: undefined,
				agent: options?.agent,
				variant: options?.variant,
			})
		},
		[],
	)

	const createSession = useCallback(async (directory: string, title?: string) => {
		const client = getProjectClient(directory)
		if (!client) throw new Error("Not connected to OpenCode server")
		const result = await client.session.create({ title })
		const session = result.data
		// Add to store immediately so navigation finds it before SSE arrives
		if (session) {
			useAppStore.getState().setSession(session, directory)
		}
		return session
	}, [])

	const renameSession = useCallback(async (directory: string, sessionId: string, title: string) => {
		const client = getProjectClient(directory)
		if (!client) throw new Error("Not connected to OpenCode server")

		// Optimistic update — change title in store immediately
		const store = useAppStore.getState()
		const entry = store.sessions[sessionId]
		if (entry) {
			store.setSession({ ...entry.session, title }, entry.directory)
		}

		await client.session.update({ sessionID: sessionId, title })
	}, [])

	const deleteSession = useCallback(async (directory: string, sessionId: string) => {
		const client = getProjectClient(directory)
		if (!client) throw new Error("Not connected to OpenCode server")
		await client.session.delete({ sessionID: sessionId })
	}, [])

	const respondToPermission = useCallback(
		async (
			directory: string,
			sessionId: string,
			permissionId: string,
			response: "once" | "always" | "reject",
		) => {
			const client = getProjectClient(directory)
			if (!client) throw new Error("Not connected to OpenCode server")
			await client.permission.respond({
				sessionID: sessionId,
				permissionID: permissionId,
				response,
			})
		},
		[],
	)

	const replyToQuestion = useCallback(
		async (directory: string, requestId: string, answers: QuestionAnswer[]) => {
			const client = getProjectClient(directory)
			if (!client) throw new Error("Not connected to OpenCode server")
			await client.question.reply({ requestID: requestId, answers })
		},
		[],
	)

	const rejectQuestion = useCallback(async (directory: string, requestId: string) => {
		const client = getProjectClient(directory)
		if (!client) throw new Error("Not connected to OpenCode server")
		await client.question.reject({ requestID: requestId })
	}, [])

	return {
		abort,
		sendPrompt,
		createSession,
		renameSession,
		deleteSession,
		respondToPermission,
		replyToQuestion,
		rejectQuestion,
	}
}
