import { useCallback } from "react"
import type { TextPart, UserMessage } from "../lib/types"
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
			const optimisticPart: TextPart = {
				id: `${optimisticId}-text`,
				sessionID: sessionId,
				messageID: optimisticId,
				type: "text",
				text,
			}
			const store = useAppStore.getState()
			store.upsertMessage(optimisticMessage)
			store.upsertPart(optimisticPart)

			await client.session.promptAsync({
				sessionID: sessionId,
				parts: [{ type: "text", text }],
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

	return {
		abort,
		sendPrompt,
		createSession,
		deleteSession,
		respondToPermission,
	}
}
