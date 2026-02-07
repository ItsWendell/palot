import type { OpencodeClient } from "@opencode-ai/sdk/client"
import { useAppStore } from "../stores/app-store"
import { connectToServer, getSessionStatuses, listSessions, subscribeToEvents } from "./opencode"

/** Active connections, keyed by server ID */
const connections = new Map<
	string,
	{
		client: OpencodeClient
		abortController: AbortController
	}
>()

/**
 * Connect to an OpenCode server and start listening for events.
 * This is called once per server when the app starts or when a new server is added.
 */
export async function connectAndSubscribe(
	serverId: string,
	url: string,
	directory: string,
): Promise<OpencodeClient> {
	const store = useAppStore.getState()

	// Register server in store
	store.addServer(serverId, url, directory)

	// Create client
	const client = connectToServer(url, directory)
	const abortController = new AbortController()

	connections.set(serverId, { client, abortController })

	// Load initial data
	try {
		const [sessions, statuses] = await Promise.all([
			listSessions(client),
			getSessionStatuses(client),
		])
		store.setSessions(serverId, sessions, statuses)
		store.setServerConnected(serverId, true)
	} catch (err) {
		console.error(`Failed to load initial data for server ${serverId}:`, err)
	}

	// Start event subscription in background
	startEventLoop(serverId, client, abortController.signal)

	return client
}

/**
 * Disconnect from a server and stop listening.
 */
export function disconnect(serverId: string): void {
	const conn = connections.get(serverId)
	if (conn) {
		conn.abortController.abort()
		connections.delete(serverId)
	}
	useAppStore.getState().removeServer(serverId)
}

/**
 * Get the client for a server.
 */
export function getClient(serverId: string): OpencodeClient | undefined {
	return connections.get(serverId)?.client
}

/**
 * Background event loop that processes SSE events.
 * Reconnects on disconnect with exponential backoff.
 */
async function startEventLoop(
	serverId: string,
	client: OpencodeClient,
	signal: AbortSignal,
): Promise<void> {
	let retryDelay = 1000

	while (!signal.aborted) {
		try {
			const stream = await subscribeToEvents(client)
			retryDelay = 1000 // Reset on successful connect

			for await (const event of stream) {
				if (signal.aborted) break
				useAppStore.getState().processEvent(serverId, event)
			}
		} catch (err) {
			if (signal.aborted) break
			console.error(`Event stream for server ${serverId} disconnected:`, err)
			useAppStore.getState().setServerConnected(serverId, false)
		}

		if (signal.aborted) break

		// Exponential backoff: 1s, 2s, 4s, 8s, max 30s
		await new Promise((resolve) => setTimeout(resolve, retryDelay))
		retryDelay = Math.min(retryDelay * 2, 30000)
	}
}
