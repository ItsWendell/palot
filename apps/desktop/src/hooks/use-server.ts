import { useCallback, useRef } from "react"
import { connectAndSubscribe, disconnect, getClient } from "../services/connection-manager"
import { useAppStore } from "../stores/app-store"

/**
 * Hook for managing OpenCode server connections.
 * Provides connect/disconnect and exposes connection state.
 */
export function useServerConnection() {
	const servers = useAppStore((s) => s.servers)
	const nextIdRef = useRef(1)

	const connect = useCallback(async (url: string, directory: string) => {
		const serverId = `server-${nextIdRef.current++}`
		await connectAndSubscribe(serverId, url, directory)
		return serverId
	}, [])

	const disconnectServer = useCallback((serverId: string) => {
		disconnect(serverId)
	}, [])

	const connectedServers = Object.values(servers).filter((s) => s.connected)
	const hasConnections = connectedServers.length > 0

	return {
		servers,
		connectedServers,
		hasConnections,
		connect,
		disconnect: disconnectServer,
	}
}

/**
 * Hook for agent actions (stop, approve, deny, etc.).
 * These operate on real OpenCode sessions via the SDK.
 */
export function useAgentActions() {
	const abort = useCallback(async (serverId: string, sessionId: string) => {
		const client = getClient(serverId)
		if (!client) throw new Error("Server not connected")
		await client.session.abort({ path: { id: sessionId } })
	}, [])

	const sendPrompt = useCallback(async (serverId: string, sessionId: string, text: string) => {
		const client = getClient(serverId)
		if (!client) throw new Error("Server not connected")
		await client.session.promptAsync({
			path: { id: sessionId },
			body: { parts: [{ type: "text", text }] },
		})
	}, [])

	const createSession = useCallback(async (serverId: string, title?: string) => {
		const client = getClient(serverId)
		if (!client) throw new Error("Server not connected")
		const result = await client.session.create({ body: { title } })
		return result.data
	}, [])

	const deleteSession = useCallback(async (serverId: string, sessionId: string) => {
		const client = getClient(serverId)
		if (!client) throw new Error("Server not connected")
		await client.session.delete({ path: { id: sessionId } })
	}, [])

	const respondToPermission = useCallback(
		async (
			serverId: string,
			sessionId: string,
			permissionId: string,
			response: "once" | "always" | "reject",
		) => {
			const client = getClient(serverId)
			if (!client) throw new Error("Server not connected")
			await client.postSessionIdPermissionsPermissionId({
				path: { id: sessionId, permissionID: permissionId },
				body: { response },
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
